'use strict';

const { serviceStore } = require('../services/store');

// x402 batch-settlement requires atomic updates across all Vercel instances.
class SqlChannelStorage {
  async client() {
    const client = await serviceStore.init();
    await client.execute('CREATE TABLE IF NOT EXISTS inference_channels (channel_id TEXT PRIMARY KEY, state TEXT NOT NULL)');
    return client;
  }

  async get(channelId) {
    const client = await this.client();
    const rows = await client.execute({ sql: 'SELECT state FROM inference_channels WHERE channel_id = ?', args: [channelId.toLowerCase()] });
    return rows.rows[0] ? JSON.parse(rows.rows[0].state) : undefined;
  }

  async list() {
    const client = await this.client();
    const rows = await client.execute('SELECT state FROM inference_channels');
    return rows.rows.map(row => JSON.parse(row.state));
  }

  async updateChannel(channelId, update) {
    // libSQL's embedded client has one connection. Serialize same-process writes;
    // the SQL write transaction additionally serializes across Turso instances.
    const operation = (SqlChannelStorage.tail || Promise.resolve()).then(() => this.updateChannelLocked(channelId, update));
    SqlChannelStorage.tail = operation.catch(() => {});
    return operation;
  }

  async updateChannelLocked(channelId, update) {
    const client = await this.client();
    const tx = await client.transaction('write');
    try {
      const key = channelId.toLowerCase();
      const rows = await tx.execute({ sql: 'SELECT state FROM inference_channels WHERE channel_id = ?', args: [key] });
      const current = rows.rows[0] ? JSON.parse(rows.rows[0].state) : undefined;
      const next = update(current);
      if (next && typeof next.then === 'function') throw new Error('Channel update callback must be synchronous');
      if (next === current) {
        await tx.commit();
        return { channel: current, status: 'unchanged' };
      }
      if (next === undefined) {
        if (current) await tx.execute({ sql: 'DELETE FROM inference_channels WHERE channel_id = ?', args: [key] });
        await tx.commit();
        return { channel: undefined, status: current ? 'deleted' : 'unchanged' };
      }
      await tx.execute({ sql: 'INSERT INTO inference_channels(channel_id, state) VALUES (?, ?) ON CONFLICT(channel_id) DO UPDATE SET state = excluded.state', args: [key, JSON.stringify(next)] });
      await tx.commit();
      return { channel: next, status: 'updated' };
    } catch (error) {
      try { await tx.rollback(); } catch {}
      throw error;
    }
  }
}

module.exports = { SqlChannelStorage };
