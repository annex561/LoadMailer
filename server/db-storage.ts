import { eq } from "drizzle-orm";
import { db } from "./db";
import { onboardingTokens, drivers } from "@shared/schema";
import { type OnboardingToken, type InsertOnboardingToken, type Driver, type InsertDriver } from "@shared/schema";
import { randomUUID } from "crypto";

export class DatabaseOnboardingTokenService {
  // Create onboarding token in database
  async createOnboardingToken(tokenData: InsertOnboardingToken): Promise<OnboardingToken> {
    const [token] = await db.insert(onboardingTokens).values(tokenData).returning();
    return token;
  }

  // Get onboarding token from database
  async getOnboardingToken(tokenValue: string): Promise<OnboardingToken | undefined> {
    const [token] = await db.select().from(onboardingTokens).where(eq(onboardingTokens.token, tokenValue));
    return token;
  }

  // Get all onboarding tokens from database
  async getAllOnboardingTokens(): Promise<OnboardingToken[]> {
    return await db.select().from(onboardingTokens);
  }

  // Mark token as used in database
  async markTokenAsUsed(tokenValue: string): Promise<boolean> {
    const result = await db.update(onboardingTokens)
      .set({ isUsed: true })
      .where(eq(onboardingTokens.token, tokenValue));
    
    return result.rowCount > 0;
  }

  // Create driver in database  
  async createDriver(driverData: InsertDriver): Promise<Driver> {
    const [driver] = await db.insert(drivers).values(driverData).returning();
    return driver;
  }

  // Validate token and check if it's valid and not used
  async validateToken(tokenValue: string): Promise<{ valid: boolean; email?: string; error?: string }> {
    console.log("🔍 DB Token validation:", { tokenValue, timestamp: new Date().toISOString() });
    
    const token = await this.getOnboardingToken(tokenValue);
    
    console.log("🔍 DB Token lookup result:", { token: token ? { id: token.id, isUsed: token.isUsed, expiresAt: token.expiresAt } : null });
    
    if (!token) {
      console.log("❌ Token not found in database");
      return { valid: false, error: "Token not found" };
    }

    if (token.isUsed) {
      console.log("❌ Token already used");
      return { valid: false, error: "Token already used" };
    }

    if (new Date() > new Date(token.expiresAt)) {
      console.log("❌ Token expired");
      return { valid: false, error: "Token expired" };
    }

    console.log("✅ Token validation successful");
    return { valid: true, email: token.email };
  }
}