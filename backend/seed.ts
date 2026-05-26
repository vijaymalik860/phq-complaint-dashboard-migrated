/**
 * PHQ Dashboard — Comprehensive Seed Script
 * Seeds realistic dummy data for all 22 Haryana districts
 * Run: npx ts-node seed.ts
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// All 22 Haryana districts (matching actual government data)
const DISTRICTS = [
  { name: 'AMBALA', code: 'AMB' },
  { name: 'BHIWANI', code: 'BHW' },
  { name: 'CHARKHI DADRI', code: 'CHD' },
  { name: 'FARIDABAD', code: 'FBD' },
  { name: 'FATEHABAD', code: 'FTB' },
  { name: 'GURUGRAM', code: 'GGN' },
  { name: 'HISAR', code: 'HSR' },
  { name: 'JHAJJAR', code: 'JJR' },
  { name: 'JIND', code: 'JND' },
  { name: 'KAITHAL', code: 'KTL' },
  { name: 'KARNAL', code: 'KNL' },
  { name: 'KURUKSHETRA', code: 'KKR' },
  { name: 'MAHENDRAGARH', code: 'MHG' },
  { name: 'NUH', code: 'NUH' },
  { name: 'PALWAL', code: 'PWL' },
  { name: 'PANCHKULA', code: 'PKL' },
  { name: 'PANIPAT', code: 'PNP' },
  { name: 'REWARI', code: 'RWR' },
  { name: 'ROHTAK', code: 'RHT' },
  { name: 'SIRSA', code: 'SRS' },
  { name: 'SONIPAT', code: 'SNP' },
  { name: 'YAMUNANAGAR', code: 'YMN' },
];

const COMPLAINT_TYPES = [
  'General Complaint', 'Land Dispute', 'Domestic Violence',
  'Theft', 'Fraud', 'Corruption', 'Missing Person',
  'Assault', 'Harassment', 'Traffic Accident',
];

const INCIDENT_CLASSES = [
  'IPC Crime', 'SLL Crime', 'Cyber Crime', 'Property Crime',
  'Crime Against Women', 'Crime Against Children',
  'Economic Offence', 'Road Accident', 'Missing', 'Other',
];

const RECEPTION_MODES = [
  'Online Portal', 'Written Application', 'Email', 'Walk-in',
  'Telephone', 'CM Window', 'SP Office', 'Headquarters',
];

const COMPLAINT_SOURCES = [
  'CM Window', 'Online Portal', 'Court Directed', 'DGP Office',
  'State Human Rights Commission', 'High Court', 'Supreme Court',
  'NHRC', 'State Commission for Women', 'Direct',
];

const TYPES_AGAINST = [
  'Police Personnel', 'Revenue Official', 'Municipal Official',
  'Private Individual', 'Corporation', 'Bank Official',
  'Government Employee', 'Unknown',
];

const ACTIONS_TAKEN = [
  'Inquiry Initiated', 'FIR Registered', 'Referred to Concerned SP',
  'Resolved Amicably', 'Disposed', 'Under Investigation',
  'Sent to Court', 'Closed - No Substance', 'Transferred',
];

const BRANCHES = [
  'CID', 'Crime Branch', 'Traffic', 'Women Cell',
  'Anti-Corruption', 'Cyber Crime Cell', 'SIT',
  'District Police', 'Special Branch',
];

const INCIDENT_TYPES_WS = [
  'Domestic Violence', 'Eve Teasing', 'Sexual Harassment',
  'Dowry Harassment', 'Stalking', 'Acid Attack',
  'Human Trafficking', 'Sexual Assault', 'Kidnapping', 'Other',
];

const FIRST_NAMES = ['Rajesh', 'Suresh', 'Ramesh', 'Priya', 'Sunita', 'Anita', 'Harish', 'Deepak', 'Mohit', 'Vinod', 'Geeta', 'Kavita', 'Rekha', 'Pooja', 'Sanjay', 'Vijay', 'Amit', 'Ravi', 'Dinesh', 'Sunil'];
const LAST_NAMES = ['Sharma', 'Verma', 'Singh', 'Yadav', 'Gupta', 'Kumar', 'Malik', 'Rana', 'Hooda', 'Dahiya', 'Nain', 'Khatri', 'Arora', 'Chaudhary', 'Bhardwaj', 'Mittal', 'Jain', 'Sood', 'Rao', 'Pillai'];
const VILLAGES = ['Sector 14', 'Model Town', 'Civil Lines', 'Sadar Bazar', 'New Colony', 'Old Town', 'Gandhi Nagar', 'Nehru Nagar', 'Shastri Nagar', 'Indira Colony'];
const TEHSILS = ['Sadar', 'City', 'East', 'West', 'North', 'South', 'Central'];
const ACCUSED_NAMES = ['Unknown Person', 'Mahesh Kumar', 'Ranjit Singh', 'Deepak Sharma', 'Suresh Yadav', 'Rakesh Kumar', 'Vikas Goyal', 'Naresh Saini'];
const ACT_SECTIONS = ['IPC 420', 'IPC 323', 'IPC 354', 'IPC 376', 'IPC 302', 'IPC 307', 'IPC 498A', 'IPC 506', 'Sections 3/4 PDPP Act', 'Section 66 IT Act'];
const PSR_PREFIXES = ['AMB', 'BHW', 'FBD', 'GGN', 'HSR', 'KNL', 'PNP', 'RHT', 'SNP', 'YMN'];

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randDate(daysBack: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - randInt(0, daysBack));
  d.setHours(randInt(8, 18), randInt(0, 59), 0, 0);
  return d;
}

function randStatus(regDate: Date): { status: string; disposalDate: Date | null } {
  const daysSince = Math.floor((Date.now() - regDate.getTime()) / (1000 * 60 * 60 * 24));
  if (daysSince > 60 && Math.random() > 0.3) {
    const disposalDate = new Date(regDate.getTime() + randInt(30, daysSince) * 86400000);
    return { status: 'Disposed', disposalDate };
  }
  if (Math.random() > 0.7) {
    return { status: 'Disposed', disposalDate: new Date(regDate.getTime() + randInt(5, 30) * 86400000) };
  }
  return { status: 'Pending', disposalDate: null };
}

function randMobile(): string {
  return `9${randInt(1, 9)}${Array.from({ length: 8 }, () => randInt(0, 9)).join('')}`;
}

async function main() {
  console.log('🌱 Starting PHQ Dashboard seed...\n');

  // ── 1. Admin ──────────────────────────────────────────────────────
  console.log('👤 Creating admin user...');
  const hashed = await bcrypt.hash('admin123', 10);
  await prisma.admin.upsert({
    where: { username: 'admin' },
    update: {},
    create: { username: 'admin', password: hashed, role: 'admin' },
  });
  console.log('   ✅ Admin: admin / admin123\n');

  // ── 2. Districts ──────────────────────────────────────────────────
  console.log('🗺️  Seeding districts...');
  const districtRecords: { id: number; name: string }[] = [];
  for (const d of DISTRICTS) {
    const rec = await prisma.district.upsert({
      where: { name: d.name },
      update: {},
      create: { name: d.name, code: d.code },
    });
    districtRecords.push({ id: rec.id, name: rec.name });
  }
  console.log(`   ✅ ${districtRecords.length} districts created\n`);

  // ── 3. Complaints ─────────────────────────────────────────────────
  console.log('📋 Seeding complaints (50-120 per district)...');
  let complaintCount = 0;
  const complaintBatch: Parameters<typeof prisma.complaint.create>[0]['data'][] = [];

  for (const district of districtRecords) {
    const count = randInt(50, 120);
    for (let i = 0; i < count; i++) {
      const regDt = randDate(730); // last 2 years
      const { status, disposalDate } = randStatus(regDt);
      const regNum = `CMS/${district.name.slice(0, 3)}/${regDt.getFullYear()}/${String(i + 1).padStart(5, '0')}`;
      const firstName = rand(FIRST_NAMES);
      const lastName = rand(LAST_NAMES);

      complaintBatch.push({
        complRegNum: regNum,
        districtId: district.id,
        complDesc: `Complaint regarding ${rand(COMPLAINT_TYPES).toLowerCase()} at ${rand(VILLAGES)}, ${district.name}`,
        complSrno: String(i + 1),
        complRegDt: regDt,
        firstName,
        lastName,
        mobile: randMobile(),
        gender: Math.random() > 0.4 ? 'Male' : 'Female',
        age: randInt(18, 75),
        addressLine1: `House No. ${randInt(1, 500)}, ${rand(VILLAGES)}`,
        addressLine2: `${rand(TEHSILS)} Tehsil`,
        village: rand(VILLAGES),
        tehsil: rand(TEHSILS),
        addressDistrict: district.name,
        addressPs: `PS ${rand(TEHSILS)}`,
        receptionMode: rand(RECEPTION_MODES),
        incidentType: rand(COMPLAINT_TYPES),
        incidentPlc: `${rand(VILLAGES)}, ${district.name}`,
        incidentFromDt: new Date(regDt.getTime() - randInt(1, 30) * 86400000),
        incidentToDt: regDt,
        classOfIncident: rand(INCIDENT_CLASSES),
        respondentCategories: rand(TYPES_AGAINST),
        complaintSource: rand(COMPLAINT_SOURCES),
        typeOfComplaint: rand(COMPLAINT_TYPES),
        complainantType: Math.random() > 0.5 ? 'Individual' : 'Institution',
        complaintPurpose: 'Action Against Accused',
        statusOfComplaint: status,
        disposalDate,
        ioDetails: `IO: ${rand(FIRST_NAMES)} ${rand(LAST_NAMES)}, Rank: Inspector`,
        branch: rand(BRANCHES),
        firNumber: status === 'Disposed' ? `FIR/${district.name.slice(0, 3)}/${regDt.getFullYear()}/${randInt(1, 9999)}` : null,
        actionTaken: rand(ACTIONS_TAKEN),
      });
    }
    complaintCount += count;
  }

  // Insert complaints in chunks of 50 using upsert (safe to re-run)
  const CHUNK = 50;
  for (let i = 0; i < complaintBatch.length; i += CHUNK) {
    const chunk = complaintBatch.slice(i, i + CHUNK);
    await Promise.all(chunk.map(data => prisma.complaint.upsert({
      where: { complRegNum: data.complRegNum as string },
      update: {},
      create: data,
    })));
    process.stdout.write(`\r   Inserted ${Math.min(i + CHUNK, complaintBatch.length)} / ${complaintBatch.length} complaints...`);
  }
  console.log(`\n   ✅ ${complaintCount} complaints created\n`);

  // ── 4. Women Safety ───────────────────────────────────────────────
  console.log('👩 Seeding women safety records (10-30 per district)...');
  let wsCount = 0;
  for (const district of districtRecords) {
    const count = randInt(10, 30);
    for (let i = 0; i < count; i++) {
      const regDt = randDate(365);
      const { status, disposalDate } = randStatus(regDt);
      const regNum = `WS/${district.name.slice(0, 3)}/${regDt.getFullYear()}/${String(i + 1).padStart(4, '0')}`;
      try {
        await prisma.womenSafety.create({
          data: {
            complRegNum: regNum,
            districtId: district.id,
            complDesc: `Women safety complaint: ${rand(INCIDENT_TYPES_WS)} at ${district.name}`,
            complRegDt: regDt,
            firstName: rand(FIRST_NAMES),
            lastName: rand(LAST_NAMES),
            mobile: randMobile(),
            gender: 'Female',
            age: randInt(16, 60),
            addressLine1: `${randInt(1, 300)} ${rand(VILLAGES)}`,
            village: rand(VILLAGES),
            tehsil: rand(TEHSILS),
            incidentType: rand(INCIDENT_TYPES_WS),
            incidentPlc: `${rand(VILLAGES)}, ${district.name}`,
            incidentFromDt: new Date(regDt.getTime() - randInt(1, 7) * 86400000),
            incidentToDt: regDt,
            complaintSource: rand(COMPLAINT_SOURCES),
            statusOfComplaint: status,
            disposalDate,
          },
        });
        wsCount++;
      } catch { /* skip duplicate */ }
    }
  }
  console.log(`   ✅ ${wsCount} women safety records created\n`);

  // ── 5. CCTNS Complaints ───────────────────────────────────────────
  console.log('🔗 Seeding CCTNS complaints (15-40 per district)...');
  let cctnsCount = 0;
  for (const district of districtRecords) {
    const count = randInt(15, 40);
    for (let i = 0; i < count; i++) {
      const incidentDate = randDate(365);
      const prefix = rand(PSR_PREFIXES);
      const regNum = `CCTNS/${district.name.slice(0, 3)}/${incidentDate.getFullYear()}/${String(i + 1).padStart(5, '0')}`;
      try {
        await prisma.cCTNSComplaint.create({
          data: {
            complRegNum: regNum,
            districtId: district.id,
            compCategory: rand(INCIDENT_CLASSES),
            psrNumber: `${prefix}/${incidentDate.getFullYear()}/${randInt(1000, 9999)}`,
            firNumber: `FIR/${prefix}/${incidentDate.getFullYear()}/${randInt(1, 999)}`,
            firDate: new Date(incidentDate.getTime() + randInt(1, 5) * 86400000),
            ActSection: rand(ACT_SECTIONS),
            accusedName: rand(ACCUSED_NAMES),
            accusedAge: randInt(18, 60),
            accusedAddress: `${rand(VILLAGES)}, ${district.name}`,
            victimName: `${rand(FIRST_NAMES)} ${rand(LAST_NAMES)}`,
            incidentDate,
          },
        });
        cctnsCount++;
      } catch { /* skip duplicate */ }
    }
  }
  console.log(`   ✅ ${cctnsCount} CCTNS complaint records created\n`);

  // ── 6. Summary ────────────────────────────────────────────────────
  const totalComplaints = await prisma.complaint.count();
  const totalDisposed = await prisma.complaint.count({ where: { statusOfComplaint: 'Disposed' } });
  const totalPending = await prisma.complaint.count({ where: { statusOfComplaint: 'Pending' } });
  const totalWS = await prisma.womenSafety.count();
  const totalCCTNS = await prisma.cCTNSComplaint.count();

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ SEED COMPLETE — DATABASE SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`   Districts:           ${districtRecords.length}`);
  console.log(`   Complaints (total):  ${totalComplaints}`);
  console.log(`     → Disposed:        ${totalDisposed}`);
  console.log(`     → Pending:         ${totalPending}`);
  console.log(`   Women Safety:        ${totalWS}`);
  console.log(`   CCTNS Complaints:    ${totalCCTNS}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main()
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
