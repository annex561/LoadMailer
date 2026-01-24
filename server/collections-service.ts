import { db } from "./db";
import { arInvoices, collectionsItems, activityLog } from "@shared/schema";
import { eq, and, ne, lte, gte } from "drizzle-orm";
import { differenceInDays, isBefore, isSameDay, addDays } from "date-fns";

export class CollectionsService {
  /**
   * Calculates aging buckets for the Executive Dashboard and Collections view.
   * Returns totals in cents.
   */
  async getAgingSummary(companyId: string) {
    const today = new Date();
    const unpaidInvoices = await db.select().from(arInvoices).where(
      and(
        eq(arInvoices.companyId, companyId),
        ne(arInvoices.status, "paid"),
        ne(arInvoices.status, "void")
      )
    );

    const buckets = {
      current: 0,
      days_1_7: 0,
      days_8_14: 0,
      days_15_30: 0,
      days_31_60: 0,
      days_61_plus: 0,
      total: 0,
      count: unpaidInvoices.length,
    };

    unpaidInvoices.forEach(inv => {
      const dpd = differenceInDays(today, inv.dueDate);
      const balance = inv.balanceDueCents;
      
      if (dpd <= 0) buckets.current += balance;
      else if (dpd <= 7) buckets.days_1_7 += balance;
      else if (dpd <= 14) buckets.days_8_14 += balance;
      else if (dpd <= 30) buckets.days_15_30 += balance;
      else if (dpd <= 60) buckets.days_31_60 += balance;
      else buckets.days_61_plus += balance;
      
      buckets.total += balance;
    });

    return buckets;
  }

  /**
   * Assigns the "Traffic Light" status for the UI.
   * RED = overdue, YELLOW = due today, GREEN = future
   */
  async getItemsQueue(companyId: string) {
    const today = new Date();
    const items = await db.select().from(collectionsItems).where(
      and(
        eq(collectionsItems.companyId, companyId),
        ne(collectionsItems.status, "closed")
      )
    );

    return items.map(item => {
      let trafficLight = "GREEN";
      if (item.nextActionAt) {
        if (isBefore(item.nextActionAt, today) && !isSameDay(item.nextActionAt, today)) {
          trafficLight = "RED";
        } else if (isSameDay(item.nextActionAt, today)) {
          trafficLight = "YELLOW";
        }
      }
      return { ...item, trafficLight };
    });
  }

  /**
   * Get a single item with its invoice details for the detail view.
   */
  async getItemWithInvoice(itemId: string) {
    const [item] = await db.select().from(collectionsItems).where(eq(collectionsItems.id, itemId));
    if (!item) return null;

    const [invoice] = await db.select().from(arInvoices).where(eq(arInvoices.id, item.invoiceId));
    
    const today = new Date();
    let trafficLight = "GREEN";
    if (item.nextActionAt) {
      if (isBefore(item.nextActionAt, today) && !isSameDay(item.nextActionAt, today)) {
        trafficLight = "RED";
      } else if (isSameDay(item.nextActionAt, today)) {
        trafficLight = "YELLOW";
      }
    }

    return { item: { ...item, trafficLight }, invoice };
  }

  /**
   * Logic for "Touching" an item and scheduling the next follow-up.
   */
  async logTouch(itemId: string, stage: "soft" | "firm" | "final", actorId: string, notes?: string) {
    const intervals = { soft: 2, firm: 1, final: 0 };
    const nextActionDate = addDays(new Date(), intervals[stage]);

    const [updatedItem] = await db.update(collectionsItems)
      .set({
        lastTouchAt: new Date(),
        nextActionAt: nextActionDate,
        stage: stage,
        status: "in_progress",
        updatedAt: new Date(),
      })
      .where(eq(collectionsItems.id, itemId))
      .returning();

    if (updatedItem) {
      await db.insert(activityLog).values({
        companyId: updatedItem.companyId,
        entityType: "COLLECTION",
        entityId: itemId,
        action: `TOUCH_${stage.toUpperCase()}`,
        actor: actorId,
        details: { 
          stage, 
          nextActionAt: nextActionDate.toISOString(),
          notes 
        }
      });
    }

    return updatedItem;
  }

  /**
   * Record a payment promise from the customer.
   */
  async recordPromise(itemId: string, promiseDate: Date, actorId: string, notes?: string) {
    const [updatedItem] = await db.update(collectionsItems)
      .set({
        promiseDate: promiseDate,
        status: "promise",
        nextActionAt: addDays(promiseDate, 1),
        nextActionKind: "CALL",
        lastTouchAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(collectionsItems.id, itemId))
      .returning();

    if (updatedItem) {
      await db.insert(activityLog).values({
        companyId: updatedItem.companyId,
        entityType: "COLLECTION",
        entityId: itemId,
        action: "PROMISE_RECORDED",
        actor: actorId,
        details: { 
          promiseDate: promiseDate.toISOString(),
          notes 
        }
      });
    }

    return updatedItem;
  }

  /**
   * Escalate an item to a higher level (L1, L2, L3).
   */
  async escalate(itemId: string, level: "L1" | "L2" | "L3", actorId: string, reason?: string) {
    const [updatedItem] = await db.update(collectionsItems)
      .set({
        escalationLevel: level,
        status: "escalated",
        stage: "escalated",
        nextActionAt: addDays(new Date(), 1),
        nextActionKind: "CALL",
        lastTouchAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(collectionsItems.id, itemId))
      .returning();

    if (updatedItem) {
      await db.insert(activityLog).values({
        companyId: updatedItem.companyId,
        entityType: "COLLECTION",
        entityId: itemId,
        action: `ESCALATED_TO_${level}`,
        actor: actorId,
        details: { 
          level,
          reason 
        }
      });
    }

    return updatedItem;
  }

  /**
   * Close an item (paid, written off, or disputed).
   */
  async closeItem(itemId: string, resolution: "paid" | "written_off" | "dispute", actorId: string, notes?: string) {
    const finalStatus = resolution === "dispute" ? "dispute" : "closed";
    
    const [updatedItem] = await db.update(collectionsItems)
      .set({
        status: finalStatus,
        nextActionAt: null,
        lastTouchAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(collectionsItems.id, itemId))
      .returning();

    if (updatedItem) {
      await db.insert(activityLog).values({
        companyId: updatedItem.companyId,
        entityType: "COLLECTION",
        entityId: itemId,
        action: `CLOSED_${resolution.toUpperCase()}`,
        actor: actorId,
        details: { resolution, notes }
      });
    }

    return updatedItem;
  }
}

export const collectionsService = new CollectionsService();
