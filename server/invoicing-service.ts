import { db } from "./db";
import { loads, arInvoices, collectionsItems, activityLog } from "@shared/schema";
import { eq } from "drizzle-orm";
import { addDays } from "date-fns";

export class InvoicingService {
  /**
   * Packages a load for factoring by creating an invoice and 
   * preparing the document bundle (RateCon + BOL/POD).
   * Implements the "No Leakage" rule by auto-creating collections item.
   */
  async packageForFactoring(loadId: string, actorId: string) {
    const [load] = await db.select().from(loads).where(eq(loads.id, loadId));
    
    if (!load) {
      throw new Error("Load not found.");
    }
    
    if (!load.rateconPath || !load.podPath) {
      throw new Error("Missing documents. Both RateCon and POD are required for factoring.");
    }

    if (!load.companyId) {
      throw new Error("Load must be associated with a company.");
    }

    const invoiceNumber = `INV-${load.loadNumber}`;
    const rateInCents = Math.round((load.rate || 0) * 100);
    const dueDate = addDays(new Date(), 30);

    const [newInvoice] = await db.insert(arInvoices).values({
      companyId: load.companyId,
      loadId: load.id,
      invoiceNumber: invoiceNumber,
      status: "sent",
      totalAmountCents: rateInCents,
      balanceDueCents: rateInCents,
      sentAt: new Date(),
      dueDate: dueDate,
    }).returning();

    await db.insert(collectionsItems).values({
      invoiceId: newInvoice.id,
      companyId: load.companyId,
      status: "open",
      stage: "soft",
      nextActionAt: addDays(dueDate, 1),
      nextActionKind: "SYSTEM",
      escalationLevel: "L0",
    });

    await db.insert(activityLog).values({
      companyId: load.companyId,
      entityType: "INVOICE",
      entityId: newInvoice.id,
      action: "INVOICE_PACKAGED_FOR_FACTORING",
      actor: actorId,
      details: { 
        loadId: load.id,
        loadNumber: load.loadNumber,
        rateCents: rateInCents,
        docs: ["RateCon", "BOL/POD"],
        recipient: "Factoring Company",
        dueDate: dueDate.toISOString()
      }
    });

    return {
      message: "Load packaged and invoiced successfully",
      invoice: newInvoice,
      package: {
        invoiceId: newInvoice.id,
        invoiceNumber: invoiceNumber,
        ratecon: load.rateconPath,
        pod: load.podPath,
        dueDate: dueDate
      }
    };
  }

  /**
   * Marks an invoice as paid and closes the collections item.
   */
  async markPaid(invoiceId: string, actorId: string, paymentDetails: {
    paymentMethod?: string;
    paymentReference?: string;
    amountPaidCents?: number;
  } = {}) {
    const [invoice] = await db.select().from(arInvoices).where(eq(arInvoices.id, invoiceId));
    
    if (!invoice) {
      throw new Error("Invoice not found.");
    }

    const amountPaid = paymentDetails.amountPaidCents ?? invoice.balanceDueCents;
    const newBalance = invoice.balanceDueCents - amountPaid;

    const [updatedInvoice] = await db.update(arInvoices)
      .set({
        status: newBalance <= 0 ? "paid" : "sent",
        balanceDueCents: Math.max(0, newBalance),
        paidAt: newBalance <= 0 ? new Date() : null,
        paymentMethod: paymentDetails.paymentMethod,
        paymentReference: paymentDetails.paymentReference,
      })
      .where(eq(arInvoices.id, invoiceId))
      .returning();

    if (newBalance <= 0) {
      await db.update(collectionsItems)
        .set({
          status: "closed",
          updatedAt: new Date(),
        })
        .where(eq(collectionsItems.invoiceId, invoiceId));
    }

    await db.insert(activityLog).values({
      companyId: invoice.companyId,
      entityType: "INVOICE",
      entityId: invoiceId,
      action: newBalance <= 0 ? "INVOICE_PAID" : "INVOICE_PARTIAL_PAYMENT",
      actor: actorId,
      details: {
        amountPaidCents: amountPaid,
        balanceRemainingCents: Math.max(0, newBalance),
        paymentMethod: paymentDetails.paymentMethod,
        paymentReference: paymentDetails.paymentReference,
      }
    });

    return {
      message: newBalance <= 0 ? "Invoice paid in full" : "Partial payment recorded",
      invoice: updatedInvoice,
      balanceRemaining: Math.max(0, newBalance)
    };
  }
}

export const invoicingService = new InvoicingService();
