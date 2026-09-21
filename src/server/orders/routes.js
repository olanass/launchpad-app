'use strict';
const express = require('express');
const { orders } = require('./engine');
const { ROBINHOOD_CHAIN_CONFIG: chain } = require('../config/chain');
const router = express.Router();
const token = req => (req.get('authorization') || '').replace(/^Bearer /, '');
router.use((req, res, next) => { res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); next(); });
router.get('/network', (req, res) => res.json({ chainId: chain.chainId, name: chain.name, networkId: chain.networkId,
  rpcUrl: chain.publicRpcUrl, explorerUrl: chain.explorerUrl, tokens: Object.values(chain.supportedTokens), testnet: chain.testnet }));
router.post('/', async (req, res) => res.status(201).json(await orders.create({ ...req.body, accessToken: token(req) })));
router.get('/:id', async (req, res) => res.json(await orders.get(req.params.id, token(req))));
router.post('/:id/approval-message', async (req, res) => res.json(await orders.approval(req.params.id, token(req), req.body.payer)));
router.post('/:id/approve', async (req, res) => res.json(await orders.approve(req.params.id, token(req), req.body)));
router.post('/:id/cancellation-message', async (req, res) => res.json(await orders.cancellation(req.params.id, token(req))));
router.post('/:id/cancel-approval', async (req, res) => res.json(await orders.cancelApproval(req.params.id, token(req), req.body)));
for (const action of ['reject', 'refresh', 'reopen']) router.post('/:id/' + action, async (req, res) => res.json(await orders.review(req.params.id, token(req), action)));
router.post('/:id/payment', async (req, res) => res.json(await orders.submit(req.params.id, token(req), req.body.txHash)));
router.post('/:id/reconcile', async (req, res) => res.json(await orders.reconcile(req.params.id, token(req))));
module.exports = router;
