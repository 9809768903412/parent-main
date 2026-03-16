const bcrypt = require('bcryptjs');
const prisma = require('../src/utils/prisma');

async function ensureRole(roleName) {
  return prisma.role.upsert({
    where: { roleName },
    update: {},
    create: { roleName },
  });
}

async function ensureCategory(categoryName) {
  return prisma.productCategory.upsert({
    where: { categoryName },
    update: {},
    create: { categoryName },
  });
}

async function ensureSupplier(supplierName) {
  const existing = await prisma.supplier.findFirst({ where: { supplierName } });
  if (existing) return existing;
  return prisma.supplier.create({
    data: {
      supplierName,
      country: 'Philippines',
    },
  });
}

async function ensureUser({ fullName, email, roleName, passwordHash }) {
  const role = await prisma.role.findUnique({ where: { roleName } });
  if (!role) throw new Error(`Role not found: ${roleName}`);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;

  return prisma.user.create({
    data: {
      fullName,
      email,
      passwordHash,
      roleId: role.roleId,
      status: 'ACTIVE',
      emailVerified: true,
      notificationPrefs: { twoFactorEnabled: false },
    },
  });
}

async function ensureUserRole(userId, roleName) {
  const role = await prisma.role.findUnique({ where: { roleName } });
  if (!role) throw new Error(`Role not found: ${roleName}`);
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId, roleId: role.roleId } },
    update: {},
    create: { userId, roleId: role.roleId },
  });
}

function toStatus(qtyOnHand, lowStockThreshold) {
  if (qtyOnHand <= 0) return 'OUT_OF_STOCK';
  if (qtyOnHand <= lowStockThreshold) return 'LOW_STOCK';
  return 'AVAILABLE';
}

async function ensureProduct(item) {
  const category = await prisma.productCategory.findUnique({
    where: { categoryName: item.categoryName },
  });
  if (!category) throw new Error(`Category not found: ${item.categoryName}`);

  const existing = await prisma.product.findFirst({
    where: { itemName: item.itemName },
  });
  if (existing) return existing;

  return prisma.product.create({
    data: {
      itemName: item.itemName,
      unit: item.unit,
      unitPrice: item.unitPrice,
      categoryId: category.categoryId,
      qtyOnHand: item.qtyOnHand,
      lowStockThreshold: item.lowStockThreshold,
      shelfLifeDays: item.shelfLifeDays,
      status: toStatus(item.qtyOnHand, item.lowStockThreshold),
    },
  });
}

async function main() {
  // === Roles (add missing only) ===
  const roleNames = [
    'PRESIDENT',
    'ADMIN',
    'PROJECT_MANAGER',
    'SALES_AGENT',
    'ENGINEER',
    'PAINT_CHEMIST',
    'WAREHOUSE_STAFF',
    'DELIVERY_GUY',
    'CLIENT',
  ];

  for (const roleName of roleNames) {
    await ensureRole(roleName);
  }

  // === Users (16 total) ===
  const defaultPasswordHash = await bcrypt.hash('password123', 10);
  const users = [
    { fullName: 'Emman Uy', email: 'emman.uy@impex.com', roleName: 'PRESIDENT' },
    { fullName: 'Lita de Leon', email: 'lita.deleon@impex.com', roleName: 'ADMIN' },
    { fullName: 'Josephine Padilla', email: 'josephine.padilla@impex.com', roleName: 'ADMIN' },
    { fullName: 'Princess Espino', email: 'princess.espino@impex.com', roleName: 'PROJECT_MANAGER' },
    { fullName: 'Paula Caraig', email: 'paula.caraig@impex.com', roleName: 'PROJECT_MANAGER' },
    { fullName: 'Abdul Usop', email: 'abdul.usop@impex.com', roleName: 'PROJECT_MANAGER' },
    { fullName: 'Jason Mendizabal', email: 'jason.mendizabal@impex.com', roleName: 'ENGINEER' },
    { fullName: 'Myra Flores', email: 'myra.flores@impex.com', roleName: 'SALES_AGENT' },
    { fullName: 'Letty Cervantes', email: 'letty.cervantes@impex.com', roleName: 'SALES_AGENT' },
    { fullName: 'Connie Celestial', email: 'connie.celestial@impex.com', roleName: 'SALES_AGENT' },
    { fullName: 'Charlene Biza', email: 'charlene.biza@impex.com', roleName: 'SALES_AGENT' },
    { fullName: 'Enar Valencia', email: 'enar.valencia@impex.com', roleName: 'SALES_AGENT' },
    { fullName: 'Kat Cacabilos', email: 'kat.cacabilos@impex.com', roleName: 'PAINT_CHEMIST' },
    { fullName: 'Danilo Benosa', email: 'danilo.benosa@impex.com', roleName: 'WAREHOUSE_STAFF' },
    { fullName: 'Robel Tabora', email: 'robel.tabora@impex.com', roleName: 'WAREHOUSE_STAFF' },
    { fullName: 'Carlos Martinez', email: 'carlos.martinez@impex.com', roleName: 'DELIVERY_GUY' },
  ];

  const createdUsers = [];
  for (const user of users) {
    const created = await ensureUser({ ...user, passwordHash: defaultPasswordHash });
    createdUsers.push(created);
    await ensureUserRole(created.userId, user.roleName);
  }

  // Jason Mendizabal should have both ENGINEER and PROJECT_MANAGER roles
  const jason = createdUsers.find((u) => u.email === 'jason.mendizabal@impex.com');
  if (jason) {
    await ensureUserRole(jason.userId, 'PROJECT_MANAGER');
  }

  // Assign PMs to existing projects by client name (safe, no-op if none)
  const pmPrincess = createdUsers.find((u) => u.email === 'princess.espino@impex.com');
  const pmPaula = createdUsers.find((u) => u.email === 'paula.caraig@impex.com');
  const pmAbdul = createdUsers.find((u) => u.email === 'abdul.usop@impex.com');
  if (pmPrincess) {
    await prisma.project.updateMany({
      where: { client: { clientName: { contains: 'Ateneo', mode: 'insensitive' } } },
      data: { assignedPmId: pmPrincess.userId },
    });
  }
  if (pmPaula) {
    await prisma.project.updateMany({
      where: { client: { clientName: { contains: 'Robinson', mode: 'insensitive' } } },
      data: { assignedPmId: pmPaula.userId },
    });
  }
  if (pmAbdul) {
    await prisma.project.updateMany({
      where: { client: { clientName: { contains: 'Robinson', mode: 'insensitive' } } },
      data: { assignedPmId: pmAbdul.userId },
    });
  }

  // === Suppliers ===
  const suppliers = [
    'Paco Asia Hardware',
    'Jhelet General Merchandise',
    'Rockwell Lumbr',
    'Valqua Industrial',
    'JP Camaro Hardware',
    'Knack Commercial',
    'LYS Marketing',
    'Davies Marketing',
  ];

  for (const supplierName of suppliers) {
    await ensureSupplier(supplierName);
  }

  // === Categories ===
  const categories = ['Paint & Consumables', 'Construction Chemicals', 'Machinery'];
  for (const categoryName of categories) {
    await ensureCategory(categoryName);
  }

  // === Inventory (add missing only) ===
  const inventory = [
    // Paint & Consumables
    { itemName: 'Paint brush', unit: 'pcs', unitPrice: 120, categoryName: 'Paint & Consumables', qtyOnHand: 150, lowStockThreshold: 30, shelfLifeDays: 365 },
    { itemName: 'Paint brush 1"', unit: 'pcs', unitPrice: 130, categoryName: 'Paint & Consumables', qtyOnHand: 200, lowStockThreshold: 30, shelfLifeDays: 365 },
    { itemName: 'Paint brush 1-1/2"', unit: 'pcs', unitPrice: 150, categoryName: 'Paint & Consumables', qtyOnHand: 180, lowStockThreshold: 30, shelfLifeDays: 365 },
    { itemName: 'Paint brush 2"', unit: 'pcs', unitPrice: 170, categoryName: 'Paint & Consumables', qtyOnHand: 140, lowStockThreshold: 30, shelfLifeDays: 365 },
    { itemName: 'Paint brush 3"', unit: 'pcs', unitPrice: 190, categoryName: 'Paint & Consumables', qtyOnHand: 90, lowStockThreshold: 30, shelfLifeDays: 365 },
    { itemName: 'Paint roller 7" w/ handle', unit: 'pcs', unitPrice: 220, categoryName: 'Paint & Consumables', qtyOnHand: 120, lowStockThreshold: 25, shelfLifeDays: 365 },
    { itemName: 'Paint roller 7" w/ handle (yellow)', unit: 'pcs', unitPrice: 230, categoryName: 'Paint & Consumables', qtyOnHand: 80, lowStockThreshold: 25, shelfLifeDays: 365 },
    { itemName: 'Baby roller cotton (yellow)', unit: 'pcs', unitPrice: 140, categoryName: 'Paint & Consumables', qtyOnHand: 200, lowStockThreshold: 40, shelfLifeDays: 365 },
    { itemName: 'Baby roller cotton 4" w/ handle (white)', unit: 'pcs', unitPrice: 150, categoryName: 'Paint & Consumables', qtyOnHand: 150, lowStockThreshold: 40, shelfLifeDays: 365 },
    { itemName: 'Acrylon Paint roller 4" filler (white)', unit: 'pcs', unitPrice: 160, categoryName: 'Paint & Consumables', qtyOnHand: 100, lowStockThreshold: 30, shelfLifeDays: 365 },
    { itemName: 'Acrylon Paint roller 7" w/ handle (White)', unit: 'pcs', unitPrice: 210, categoryName: 'Paint & Consumables', qtyOnHand: 90, lowStockThreshold: 30, shelfLifeDays: 365 },
    { itemName: 'Sand paper #100', unit: 'sheets', unitPrice: 8, categoryName: 'Paint & Consumables', qtyOnHand: 500, lowStockThreshold: 100, shelfLifeDays: 365 },
    { itemName: 'Sand Paper #120', unit: 'sheets', unitPrice: 9, categoryName: 'Paint & Consumables', qtyOnHand: 450, lowStockThreshold: 100, shelfLifeDays: 365 },
    { itemName: 'Sand Paper #150', unit: 'sheets', unitPrice: 10, categoryName: 'Paint & Consumables', qtyOnHand: 400, lowStockThreshold: 100, shelfLifeDays: 365 },
    { itemName: 'Sand paper #180', unit: 'sheets', unitPrice: 10, categoryName: 'Paint & Consumables', qtyOnHand: 350, lowStockThreshold: 100, shelfLifeDays: 365 },
    { itemName: 'Paint thinner', unit: 'liters', unitPrice: 120, categoryName: 'Paint & Consumables', qtyOnHand: 300, lowStockThreshold: 40, shelfLifeDays: 365 },
    { itemName: 'Lacquer Thinner', unit: 'liters', unitPrice: 130, categoryName: 'Paint & Consumables', qtyOnHand: 250, lowStockThreshold: 40, shelfLifeDays: 365 },
    { itemName: 'Paint Thinner', unit: 'liters', unitPrice: 125, categoryName: 'Paint & Consumables', qtyOnHand: 280, lowStockThreshold: 40, shelfLifeDays: 365 },
    { itemName: 'Spatula 2"', unit: 'pcs', unitPrice: 90, categoryName: 'Paint & Consumables', qtyOnHand: 120, lowStockThreshold: 25, shelfLifeDays: 365 },
    { itemName: 'Spatula 4"', unit: 'pcs', unitPrice: 110, categoryName: 'Paint & Consumables', qtyOnHand: 100, lowStockThreshold: 25, shelfLifeDays: 365 },
    { itemName: 'Spatula 6"', unit: 'pcs', unitPrice: 130, categoryName: 'Paint & Consumables', qtyOnHand: 80, lowStockThreshold: 25, shelfLifeDays: 365 },
    { itemName: 'Palette (pair) 4"', unit: 'pairs', unitPrice: 160, categoryName: 'Paint & Consumables', qtyOnHand: 60, lowStockThreshold: 20, shelfLifeDays: 365 },
    { itemName: 'Palette (pair) 6"', unit: 'pairs', unitPrice: 180, categoryName: 'Paint & Consumables', qtyOnHand: 50, lowStockThreshold: 20, shelfLifeDays: 365 },
    { itemName: 'Steel brush', unit: 'pcs', unitPrice: 95, categoryName: 'Paint & Consumables', qtyOnHand: 200, lowStockThreshold: 40, shelfLifeDays: 365 },
    { itemName: 'Cotton rags', unit: 'kg', unitPrice: 70, categoryName: 'Paint & Consumables', qtyOnHand: 500, lowStockThreshold: 80, shelfLifeDays: 365 },
    { itemName: 'Empty sacks', unit: 'pcs', unitPrice: 15, categoryName: 'Paint & Consumables', qtyOnHand: 1000, lowStockThreshold: 150, shelfLifeDays: 365 },

    // Construction Chemicals
    { itemName: 'Metal-tech EG (2 kgs)', unit: 'packs', unitPrice: 320, categoryName: 'Construction Chemicals', qtyOnHand: 150, lowStockThreshold: 25, shelfLifeDays: 365 },
    { itemName: 'Cerami-tech EG (1 kg)', unit: 'packs', unitPrice: 260, categoryName: 'Construction Chemicals', qtyOnHand: 200, lowStockThreshold: 25, shelfLifeDays: 365 },
    { itemName: 'Cerami-tech FG (1 kg)', unit: 'packs', unitPrice: 270, categoryName: 'Construction Chemicals', qtyOnHand: 180, lowStockThreshold: 25, shelfLifeDays: 365 },
    { itemName: 'Seal-tech AW (5 ltrs)', unit: 'cans', unitPrice: 450, categoryName: 'Construction Chemicals', qtyOnHand: 120, lowStockThreshold: 20, shelfLifeDays: 365 },
    { itemName: 'Seal-tech AW (20 ltrs)', unit: 'drums', unitPrice: 1400, categoryName: 'Construction Chemicals', qtyOnHand: 80, lowStockThreshold: 10, shelfLifeDays: 365 },
    { itemName: 'Poly-tech CSM', unit: 'rolls', unitPrice: 520, categoryName: 'Construction Chemicals', qtyOnHand: 100, lowStockThreshold: 15, shelfLifeDays: 365 },
    { itemName: 'Epoxy Injection', unit: 'kits', unitPrice: 950, categoryName: 'Construction Chemicals', qtyOnHand: 90, lowStockThreshold: 15, shelfLifeDays: 365 },
    { itemName: 'Chopped Strand Matt 230', unit: 'rolls', unitPrice: 680, categoryName: 'Construction Chemicals', qtyOnHand: 70, lowStockThreshold: 10, shelfLifeDays: 365 },

    // Machinery
    { itemName: 'Portable Grinder', unit: 'units', unitPrice: 3800, categoryName: 'Machinery', qtyOnHand: 15, lowStockThreshold: 5, shelfLifeDays: 730 },
    { itemName: 'Hand drill', unit: 'units', unitPrice: 3200, categoryName: 'Machinery', qtyOnHand: 20, lowStockThreshold: 5, shelfLifeDays: 730 },
    { itemName: 'Injection machine', unit: 'units', unitPrice: 25000, categoryName: 'Machinery', qtyOnHand: 8, lowStockThreshold: 2, shelfLifeDays: 730 },
    { itemName: 'Chipping gun', unit: 'units', unitPrice: 5600, categoryName: 'Machinery', qtyOnHand: 12, lowStockThreshold: 3, shelfLifeDays: 730 },
    { itemName: 'Welding machine', unit: 'units', unitPrice: 18000, categoryName: 'Machinery', qtyOnHand: 10, lowStockThreshold: 2, shelfLifeDays: 730 },
  ];

  for (const item of inventory) {
    await ensureProduct(item);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
