export type NotificationLevel = 'info' | 'warn' | 'error';

export interface Notification {
  level: NotificationLevel;
  title: string;
  message: string;
  occurredAt: string;
}

export interface NotifyPort {
  publish(notification: Notification): Promise<void>;
  recent(limit: number): Promise<Notification[]>;
}
