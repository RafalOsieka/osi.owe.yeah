import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { trips } from './trips';

/**
 * A device's subscription to Notifications in one Trip (#41): one per device per Trip,
 * replaced when the device registers it again, e.g. with a new Claim, and deleted when it
 * turns notifications off, forgets the Trip, or the push service says the endpoint is gone.
 * One browser has one endpoint, so its Trips share it.
 */
export const notificationSubscriptions = pgTable(
  'notification_subscriptions',
  {
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    // The device's opaque id, the one its changes carry.
    deviceId: text().notNull(),
    endpoint: text().notNull(),
    // The browser's keys that encrypt what is sent to the endpoint.
    p256dh: text().notNull(),
    auth: text().notNull(),
    // The Participant the device claims: it is told about changes that affect them and that
    // were made under another Claim. Not a reference: it is what the device said.
    claimId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // Bumped by Drizzle on every update made through the schema.
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [primaryKey({ columns: [table.tripId, table.deviceId] })],
);
