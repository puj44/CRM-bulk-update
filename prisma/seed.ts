// fills the contacts table with fake data so there's something to bulk update.
// usage: npm run db:seed -- 50000   (wipes existing contacts, ids start again from 1)

import prisma from '../src/lib/prisma';
import { SEED, CONTACT_STATUSES } from '../src/config/constants';

const firstNames = ['Riya', 'Aman', 'Pujan', 'Neha', 'Karan', 'Pooja', 'Dev', 'Isha', 'Arjun', 'Meera', 'Rohan', 'Sneha'];
const lastNames = ['Shah', 'Verma', 'Mehta', 'Patel', 'Iyer', 'Joshi', 'Rao', 'Nair', 'Desai', 'Kapoor'];
const domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'example.com'];

function pick<T>(list: readonly T[], index: number): T {
  return list[index % list.length];
}

function makeContact(index: number) {
  const firstName = pick(firstNames, index);
  const lastName = pick(lastNames, Math.floor(index / firstNames.length));
  const ageRange = SEED.MAX_AGE - SEED.MIN_AGE;

  return {
    name: `${firstName} ${lastName}`,
    email: `${firstName}.${lastName}.${index}@${pick(domains, index)}`.toLowerCase(),
    age: SEED.MIN_AGE + (index % ageRange),
    status: pick(CONTACT_STATUSES, index),
  };
}

async function main() {
  const count = Number(process.argv[2]) || SEED.DEFAULT_COUNT;

  await prisma.$executeRaw`TRUNCATE TABLE "contacts" RESTART IDENTITY`;

  for (let start = 0; start < count; start += SEED.CHUNK_SIZE) {
    const size = Math.min(SEED.CHUNK_SIZE, count - start);
    const data = Array.from({ length: size }, (_, i) => makeContact(start + i));
    await prisma.contact.createMany({ data });
    console.log(`seeded ${start + size}/${count}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
