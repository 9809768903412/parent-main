const express = require('express');
const prisma = require('../utils/prisma');
const { parsePagination, buildPaginatedResponse, parseSort } = require('../utils/pagination');
const { requireAuth, requireRole } = require('../middleware/auth');
const { isPositiveInt, isNonNegativeNumber, isValidDateString, isNonEmptyString } = require('../utils/validate');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const pagination = parsePagination(req.query);
    const q = req.query.q ? String(req.query.q) : '';
    const status = req.query.status ? String(req.query.status).toUpperCase().replace(/-/g, '_') : '';
    const includeDeleted = req.query.includeDeleted === 'true';
    const onlyDeleted = req.query.onlyDeleted === 'true';
    let clientId = null;
    const role = String(req.user?.role || '').toUpperCase();
    if (role === 'CLIENT') {
      const user = await prisma.user.findUnique({ where: { userId: req.user.userId } });
      if (user?.email) {
        const client = await prisma.client.findFirst({ where: { email: user.email } });
        clientId = client?.clientId || null;
      }
    }
    const where = {
      AND: [
        onlyDeleted ? { deletedAt: { not: null } } : includeDeleted ? {} : { deletedAt: null },
        q
          ? {
              OR: [
                { drNumber: { contains: q, mode: 'insensitive' } },
                { clientOrder: { orderNumber: { contains: q, mode: 'insensitive' } } },
                { clientOrder: { client: { clientName: { contains: q, mode: 'insensitive' } } } },
              ],
            }
          : {},
        status ? { status } : {},
        clientId ? { clientOrder: { clientId } } : {},
      ],
    };
    const sort = parseSort(req.query, ['createdAt', 'status', 'eta']);
    const orderBy = sort ? { [sort.sortBy]: sort.sortDir } : { createdAt: 'desc' };
    const [deliveries, total] = await Promise.all([
      prisma.delivery.findMany({
      include: {
        clientOrder: {
          include: {
            client: true,
            project: true,
            items: { include: { product: true } },
          },
        },
      },
        where,
        skip: pagination ? (pagination.page - 1) * pagination.pageSize : undefined,
        take: pagination ? pagination.pageSize : undefined,
        orderBy,
      }),
      prisma.delivery.count({ where }),
    ]);

    const data = deliveries.map((d) => ({
      id: d.deliveryId.toString(),
      drNumber: d.drNumber,
      orderId: d.clientOrderId?.toString() || null,
      orderNumber: d.clientOrder?.orderNumber || '',
      clientId: d.clientOrder?.clientId?.toString() || null,
      clientName: d.clientOrder?.client?.clientName || 'Client',
      projectName: d.clientOrder?.project?.projectName || null,
      items: (d.clientOrder?.items || []).map((item) => ({
        itemId: item.productId?.toString() || '',
        itemName: item.product?.itemName || '',
        unit: item.product?.unit || '',
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice || 0),
        amount: Number(item.unitPrice || 0) * item.quantity,
      })),
      status: d.status.toLowerCase().replace(/_/g, '-'),
      eta: d.eta ? d.eta.toISOString() : null,
      issuedBy: 'System',
      issuedAt: d.createdAt.toISOString(),
      receivedBy: d.receivedBy || null,
      receivedAt: d.receivedAt ? d.receivedAt.toISOString() : null,
      notes: d.notes || null,
      returnRejectionReason: d.returnRejectionReason || null,
    }));

    if (pagination) {
      return res.json(buildPaginatedResponse(data, total, pagination.page, pagination.pageSize));
    }
    return res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole(['ADMIN', 'STAFF']), async (req, res, next) => {
  try {
    const { drNumber, clientOrderId, status, eta, itemsCount } = req.body;
    if (!isNonEmptyString(drNumber)) return res.status(400).json({ error: 'DR number is required' });
    if (!clientOrderId || !isPositiveInt(clientOrderId)) return res.status(400).json({ error: 'Client order is required' });
    if (eta && !isValidDateString(eta)) {
      return res.status(400).json({ error: 'Invalid ETA' });
    }
    if (itemsCount !== undefined && !isNonNegativeNumber(itemsCount)) {
      return res.status(400).json({ error: 'Invalid items count' });
    }
    if (status) {
      const s = status.toUpperCase().replace('-', '_');
      if (!['PENDING', 'IN_TRANSIT', 'DELIVERED', 'RETURN_PENDING', 'RETURN_REJECTED', 'RETURNED'].includes(s)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
    }

    const defaultEta = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const delivery = await prisma.delivery.create({
      data: {
        drNumber,
        clientOrderId: clientOrderId ? Number(clientOrderId) : null,
        status: status ? status.toUpperCase().replace('-', '_') : 'PENDING',
        eta: eta ? new Date(eta) : defaultEta,
        itemsCount,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        action: 'CREATE',
        target: 'Delivery',
        details: `Created delivery ${delivery.drNumber}`,
      },
    });

    res.status(201).json(delivery);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireRole(['ADMIN', 'STAFF']), async (req, res, next) => {
  try {
    if (req.body.status) {
      const s = req.body.status.toUpperCase().replace('-', '_');
      if (!['PENDING', 'IN_TRANSIT', 'DELIVERED', 'RETURN_PENDING', 'RETURN_REJECTED', 'RETURNED'].includes(s)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
    }
    if (req.body.receivedAt && !isValidDateString(req.body.receivedAt)) {
      return res.status(400).json({ error: 'Invalid received date' });
    }
    if (req.body.receivedBy !== undefined && !isNonEmptyString(req.body.receivedBy)) {
      return res.status(400).json({ error: 'Received by is required' });
    }
    const existing = await prisma.delivery.findUnique({
      where: { deliveryId: Number(req.params.id) },
      include: {
        clientOrder: { include: { items: { include: { product: true } }, project: true } },
      },
    });
    if (!existing) return res.status(404).json({ error: 'Delivery not found' });
    const currentStatus = existing.status;
    const requestedStatus = req.body.status ? req.body.status.toUpperCase().replace('-', '_') : null;
    if (requestedStatus) {
      const allowed =
        (currentStatus === 'PENDING' && requestedStatus === 'IN_TRANSIT') ||
        (currentStatus === 'IN_TRANSIT' && requestedStatus === 'DELIVERED') ||
        (currentStatus === 'DELIVERED' && requestedStatus === 'RETURN_PENDING') ||
        (currentStatus === 'RETURN_PENDING' && (requestedStatus === 'RETURNED' || requestedStatus === 'RETURN_REJECTED'));
      if (!allowed) {
        return res.status(400).json({ error: `Invalid status transition: ${currentStatus} -> ${requestedStatus}` });
      }
      if (requestedStatus === 'IN_TRANSIT' && existing.clientOrder?.status !== 'SHIPPED') {
        return res.status(400).json({ error: 'Order must be shipped before dispatching delivery.' });
      }
      if (requestedStatus === 'DELIVERED' && !req.body.receivedBy) {
        return res.status(400).json({ error: 'Received by is required' });
      }
      if (requestedStatus === 'RETURN_PENDING' && !req.body.notes) {
        return res.status(400).json({ error: 'Return reason is required' });
      }
      if (requestedStatus === 'RETURN_REJECTED' && !req.body.returnRejectionReason) {
        return res.status(400).json({ error: 'Return rejection reason is required' });
      }
    }
    const delivery = await prisma.delivery.update({
      where: { deliveryId: Number(req.params.id) },
      data: {
        status: requestedStatus || undefined,
        receivedBy: req.body.receivedBy,
        receivedAt: req.body.receivedAt ? new Date(req.body.receivedAt) : undefined,
        notes: req.body.notes,
        returnRejectionReason: req.body.returnRejectionReason,
      },
    });

    const updatedStatus = requestedStatus;
    if (updatedStatus && existing.clientOrderId) {
      const orderStatus =
        updatedStatus === 'IN_TRANSIT'
          ? 'SHIPPED'
          : updatedStatus === 'DELIVERED'
          ? 'DELIVERED'
          : null;
      if (orderStatus) {
        await prisma.clientOrder.update({
          where: { clientOrderId: existing.clientOrderId },
          data: { status: orderStatus },
        });
      }
    }
    if (
      updatedStatus === 'RETURNED' &&
      existing &&
      existing.status === 'RETURN_PENDING' &&
      existing.clientOrder?.items?.length
    ) {
      for (const item of existing.clientOrder.items) {
        if (!item.productId) continue;
        const product = await prisma.product.findUnique({
          where: { productId: item.productId },
        });
        if (!product) continue;
        const newBalance = product.qtyOnHand + item.quantity;
        const status = newBalance <= 0 ? 'OUT_OF_STOCK' : newBalance <= product.lowStockThreshold ? 'LOW_STOCK' : 'AVAILABLE';
        await prisma.product.update({
          where: { productId: product.productId },
          data: { qtyOnHand: newBalance, status },
        });
        await prisma.stockTransaction.create({
          data: {
            productId: product.productId,
            type: 'RETURN',
            qtyChange: item.quantity,
            newBalance,
            userId: req.user.userId,
            notes: `Returned items from ${delivery.drNumber}`,
          },
        });
      }
      await prisma.auditLog.create({
        data: {
          userId: req.user.userId,
          action: 'UPDATE',
          target: 'Stock',
          details: `Restocked items from return ${delivery.drNumber}`,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        action: 'UPDATE',
        target: 'Delivery',
        details:
          updatedStatus === 'RETURN_REJECTED'
            ? `Return rejected for ${delivery.drNumber}`
            : `Updated delivery ${delivery.drNumber}`,
      },
    });

    if (existing?.clientOrder?.clientId) {
      const client = await prisma.client.findUnique({ where: { clientId: existing.clientOrder.clientId } });
      if (client?.email) {
        const clientUser = await prisma.user.findUnique({ where: { email: client.email } });
        if (clientUser) {
          const message =
            updatedStatus === 'RETURN_REJECTED'
              ? `Return request rejected for ${delivery.drNumber}. Reason: ${req.body.returnRejectionReason || 'Not provided'}.`
              : `Delivery ${delivery.drNumber} status is now ${delivery.status.toLowerCase().replace(/_/g, ' ')}.`;
          await prisma.notification.create({
            data: {
              userId: clientUser.userId,
              type: 'DELIVERY_UPDATE',
              title: 'Delivery update',
              message,
              link: '/client/deliveries',
            },
          });
          await prisma.auditLog.create({
            data: {
              userId: req.user.userId,
              action: 'NOTIFY',
              target: 'Notification',
              details: `Sent delivery update for ${delivery.drNumber} to client`,
            },
          });
        }
      }
    }

    // Notify client on delivery updates
    if (existing?.clientOrder?.client?.email) {
      const clientUser = await prisma.user.findUnique({ where: { email: existing.clientOrder.client.email } });
      if (clientUser) {
        await prisma.notification.create({
          data: {
            userId: clientUser.userId,
            type: 'DELIVERY_UPDATE',
            title: 'Delivery update',
            message: `Delivery ${delivery.drNumber} status is now ${delivery.status.toLowerCase().replace(/_/g, ' ')}.`,
            link: '/client/deliveries',
          },
        });
        await prisma.auditLog.create({
          data: {
            userId: req.user.userId,
            action: 'NOTIFY',
            target: 'Notification',
            details: `Sent delivery update for ${delivery.drNumber} to client`,
          },
        });
      }
    }

    res.json(delivery);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/confirm', requireRole(['CLIENT']), async (req, res, next) => {
  try {
    const delivery = await prisma.delivery.findUnique({
      where: { deliveryId: Number(req.params.id) },
      include: { clientOrder: { include: { client: true, items: { include: { product: true } } } } },
    });
    if (!delivery) return res.status(404).json({ error: 'Delivery not found' });
    if (delivery.status !== 'IN_TRANSIT') {
      return res.status(400).json({ error: 'Only in-transit deliveries can be confirmed.' });
    }
    const user = await prisma.user.findUnique({ where: { userId: req.user.userId } });
    const client = user?.email
      ? await prisma.client.findFirst({ where: { email: user.email } })
      : null;
    const ownsByClient = client && delivery.clientOrder?.clientId === client.clientId;
    const ownsByCreator = delivery.clientOrder?.createdBy === req.user.userId;
    if (!ownsByClient && !ownsByCreator) return res.status(403).json({ error: 'Forbidden' });

    const receivedBy = req.body.receivedBy;
    if (!isNonEmptyString(receivedBy)) {
      return res.status(400).json({ error: 'Received by is required' });
    }

    const updated = await prisma.delivery.update({
      where: { deliveryId: delivery.deliveryId },
      data: {
        status: 'DELIVERED',
        receivedBy,
        receivedAt: new Date(),
        notes: req.body.notes || delivery.notes,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        action: 'CONFIRM',
        target: 'Delivery',
        details: `Client confirmed delivery ${updated.drNumber}`,
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/return', requireRole(['CLIENT']), async (req, res, next) => {
  try {
    const delivery = await prisma.delivery.findUnique({
      where: { deliveryId: Number(req.params.id) },
      include: { clientOrder: { include: { client: true, items: { include: { product: true } } } } },
    });
    if (!delivery) return res.status(404).json({ error: 'Delivery not found' });
    if (delivery.status !== 'DELIVERED') {
      return res.status(400).json({ error: 'Only delivered items can be returned.' });
    }
    const user = await prisma.user.findUnique({ where: { userId: req.user.userId } });
    const client = user?.email
      ? await prisma.client.findFirst({ where: { email: user.email } })
      : null;
    const ownsByClient = client && delivery.clientOrder?.clientId === client.clientId;
    const ownsByCreator = delivery.clientOrder?.createdBy === req.user.userId;
    if (!ownsByClient && !ownsByCreator) return res.status(403).json({ error: 'Forbidden' });
    if (!isNonEmptyString(req.body.reason)) {
      return res.status(400).json({ error: 'Return reason is required' });
    }

    const updated = await prisma.delivery.update({
      where: { deliveryId: delivery.deliveryId },
      data: {
        status: 'RETURN_PENDING',
        notes: req.body.reason,
      },
    });

    const admins = await prisma.user.findMany({
      where: { role: { roleName: 'ADMIN' }, deletedAt: null },
    });
    if (admins.length > 0) {
      await prisma.notification.createMany({
        data: admins.map((admin) => ({
          userId: admin.userId,
          type: 'RETURN_REQUEST',
          title: 'Return requested',
          message: `Return requested for ${updated.drNumber}. Reason: ${req.body.reason}`,
          link: '/admin/logistics',
        })),
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        action: 'UPDATE',
        target: 'Delivery',
        details: `Client requested return for delivery ${updated.drNumber}`,
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireRole(['ADMIN']), async (req, res, next) => {
  try {
    const deliveryId = Number(req.params.id);
    await prisma.delivery.update({
      where: { deliveryId },
      data: { deletedAt: new Date() },
    });
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        action: 'DELETE',
        target: 'Delivery',
        details: `Soft-deleted delivery ${deliveryId}`,
      },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.put('/:id/restore', requireRole(['ADMIN']), async (req, res, next) => {
  try {
    const deliveryId = Number(req.params.id);
    const delivery = await prisma.delivery.update({
      where: { deliveryId },
      data: { deletedAt: null },
    });
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        action: 'RESTORE',
        target: 'Delivery',
        details: `Restored delivery ${deliveryId}`,
      },
    });
    res.json(delivery);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
