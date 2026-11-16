import type { Notification, NotifyPort } from '../../application/ports/notify.port';

export class CollectingNotifyFake implements NotifyPort {
  readonly published: Notification[] = [];

  async publish(notification: Notification): Promise<void> {
    this.published.push(notification);
  }

  async recent(limit: number): Promise<Notification[]> {
    return this.published.slice(-limit).reverse();
  }
}
