/**
 * Backfill Script: Legacy Company Migration
 * 
 * This script creates a default "Legacy Company" and assigns all existing
 * data (drivers, customers, loads, threads, messages) to it. It also creates
 * admin user entries for existing authenticated users.
 * 
 * Run once during multi-tenant migration to ensure data continuity.
 */

import { db } from './db';
import { 
  companies, 
  subscriptions, 
  companyUsers,
  drivers, 
  customers, 
  loads, 
  loadCommunicationThreads, 
  loadMessages,
  users 
} from '@shared/schema';
import { eq, isNull } from 'drizzle-orm';

async function backfillLegacyCompany() {
  console.log('🚀 Starting legacy company backfill migration...\n');

  try {
    // Step 1: Check if legacy company already exists
    console.log('Step 1: Checking for existing legacy company...');
    const existingCompanies = await db
      .select()
      .from(companies)
      .where(eq(companies.name, 'Legacy Default Company'))
      .limit(1);

    let legacyCompanyId: number;

    if (existingCompanies.length > 0) {
      legacyCompanyId = existingCompanies[0].id;
      console.log(`✅ Found existing legacy company (ID: ${legacyCompanyId})\n`);
    } else {
      // Step 2: Create the legacy company
      console.log('Step 2: Creating legacy company...');
      const [newCompany] = await db
        .insert(companies)
        .values({
          name: 'Legacy Default Company',
          slug: 'legacy-default-company',
          billingEmail: 'billing@legacy.traqiq.com',
          phone: '+1-555-0100',
          isActive: true,
          settings: {
            features: {
              gpsTracking: true,
              documentManagement: true,
              smsDispatch: true,
              aiAssistant: true,
              mobileApp: true,
              analytics: true
            },
            branding: {
              companyName: 'Legacy Default Company',
              logoUrl: null
            }
          }
        })
        .returning();

      legacyCompanyId = newCompany.id;
      console.log(`✅ Created legacy company (ID: ${legacyCompanyId})\n`);

      // Step 3: Create subscription for legacy company
      console.log('Step 3: Creating subscription for legacy company...');
      await db.insert(subscriptions).values({
        companyId: legacyCompanyId,
        planTier: 'enterprise', // Grandfather them into enterprise plan
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
        cancelAtPeriodEnd: false,
        stripeSubscriptionId: null
      });
      console.log('✅ Created subscription (Enterprise plan, grandfathered)\n');
    }

    // Step 4: Update drivers with null company_id
    console.log('Step 4: Updating drivers...');
    const driversResult = await db
      .update(drivers)
      .set({ companyId: legacyCompanyId })
      .where(isNull(drivers.companyId))
      .returning({ id: drivers.id });
    console.log(`✅ Updated ${driversResult.length} drivers\n`);

    // Step 5: Update customers with null company_id
    console.log('Step 5: Updating customers...');
    const customersResult = await db
      .update(customers)
      .set({ companyId: legacyCompanyId })
      .where(isNull(customers.companyId))
      .returning({ id: customers.id });
    console.log(`✅ Updated ${customersResult.length} customers\n`);

    // Step 6: Update loads with null company_id
    console.log('Step 6: Updating loads...');
    const loadsResult = await db
      .update(loads)
      .set({ companyId: legacyCompanyId })
      .where(isNull(loads.companyId))
      .returning({ id: loads.id });
    console.log(`✅ Updated ${loadsResult.length} loads\n`);

    // Step 7: Update communication threads with null company_id
    console.log('Step 7: Updating communication threads...');
    const threadsResult = await db
      .update(loadCommunicationThreads)
      .set({ companyId: legacyCompanyId })
      .where(isNull(loadCommunicationThreads.companyId))
      .returning({ id: loadCommunicationThreads.id });
    console.log(`✅ Updated ${threadsResult.length} communication threads\n`);

    // Step 8: Update messages with null company_id
    console.log('Step 8: Updating messages...');
    const messagesResult = await db
      .update(loadMessages)
      .set({ companyId: legacyCompanyId })
      .where(isNull(loadMessages.companyId))
      .returning({ id: loadMessages.id });
    console.log(`✅ Updated ${messagesResult.length} messages\n`);

    // Step 9: Create company_users entries for existing authenticated users
    console.log('Step 9: Creating company user relationships...');
    const existingUsers = await db.select().from(users);
    
    if (existingUsers.length > 0) {
      // Check which users already have company_users entries
      const existingCompanyUsers = await db
        .select()
        .from(companyUsers)
        .where(eq(companyUsers.companyId, legacyCompanyId));

      const existingUserIds = new Set(existingCompanyUsers.map(cu => cu.userId));
      const usersToAdd = existingUsers.filter(u => !existingUserIds.has(u.id));

      if (usersToAdd.length > 0) {
        await db.insert(companyUsers).values(
          usersToAdd.map(user => ({
            companyId: legacyCompanyId,
            userId: user.id,
            role: 'admin' as const // Grant all existing users admin role
          }))
        );
        console.log(`✅ Created ${usersToAdd.length} company user relationships (role: admin)\n`);
      } else {
        console.log('✅ All existing users already linked to company\n');
      }
    } else {
      console.log('ℹ️  No existing users found - skipping company user creation\n');
    }

    // Step 10: Summary
    console.log('📊 Migration Summary:');
    console.log(`   Company ID: ${legacyCompanyId}`);
    console.log(`   Drivers migrated: ${driversResult.length}`);
    console.log(`   Customers migrated: ${customersResult.length}`);
    console.log(`   Loads migrated: ${loadsResult.length}`);
    console.log(`   Threads migrated: ${threadsResult.length}`);
    console.log(`   Messages migrated: ${messagesResult.length}`);
    console.log(`   Users linked: ${existingUsers.length}\n`);

    console.log('✅ Legacy company backfill completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Run the backfill
backfillLegacyCompany()
  .then(() => {
    console.log('\n🎉 Migration script completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Migration script failed:', error);
    process.exit(1);
  });
