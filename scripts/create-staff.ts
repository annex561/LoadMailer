import { db } from "../server/db";
import { users } from "../shared/schema";
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function main() {
  console.log("🌱 Seeding Staff Accounts...");

  const accounts = [
    { username: "annex", password: "password123", role: "admin", firstName: "Annex", lastName: "Luberisse" },
    { username: "dispatch", password: "password123", role: "dispatcher", firstName: "Head", lastName: "Dispatcher" },
    { username: "finance", password: "password123", role: "finance", firstName: "Accounting", lastName: "Dept" },
  ];

  for (const acc of accounts) {
    const hashedPassword = await hashPassword(acc.password);
    
    try {
      await db.insert(users).values({
        username: acc.username,
        password: hashedPassword,
        role: acc.role,
        firstName: acc.firstName,
        lastName: acc.lastName,
        companyId: "1"
      });
      console.log(`✅ Created: ${acc.username} (${acc.role})`);
    } catch (e: any) {
      if (e.message?.includes('duplicate') || e.code === '23505') {
        console.log(`⚠️  Skipped: ${acc.username} (already exists)`);
      } else {
        console.error(`❌ Error creating ${acc.username}:`, e.message);
      }
    }
  }

  console.log("🎉 Staff logins ready!");
  process.exit(0);
}

main();
