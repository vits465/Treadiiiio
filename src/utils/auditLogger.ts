import { db } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../logger';

export interface AuditActionEntry {
  id: string;
  timestamp: string;
  source: 'TELEGRAM' | 'DASHBOARD' | 'SYSTEM';
  action: string;
  details?: string;
}

export class AuditLogger {
  public static log(source: 'TELEGRAM' | 'DASHBOARD' | 'SYSTEM', action: string, details?: string): void {
    try {
      const id = uuidv4();
      const timestamp = new Date().toISOString();
      db.prepare(`
        INSERT INTO audit_actions (id, timestamp, source, action, details)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, timestamp, source, action, details || null);
      logger.info(`[AUDIT] [${source}] ${action}${details ? ` - ${details}` : ''}`);
    } catch (err: any) {
      logger.warn(`Failed to write audit action log: ${err.message}`);
    }
  }

  public static getRecent(limit: number = 20): AuditActionEntry[] {
    try {
      return db.prepare(`
        SELECT id, timestamp, source, action, details
        FROM audit_actions
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(limit) as AuditActionEntry[];
    } catch (err: any) {
      logger.warn(`Failed to fetch audit actions: ${err.message}`);
      return [];
    }
  }
}
