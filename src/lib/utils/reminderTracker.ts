/**
 * Reminder Tracker
 * Monitors reminder deadlines and triggers notifications
 */

export interface TrackedReminder {
  _id: string;
  title: string;
  description?: string;
  dueDate: Date;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: string;
  notifiedTimes: Set<string>; // Track which time thresholds we've already notified
}

export interface ReminderNotification {
  id: string;
  title: string;
  message: string;
  urgency: 'info' | 'warning' | 'urgent' | 'overdue';
  timeLeft: string;
  reminder: TrackedReminder;
}

type ReminderCallback = (notification: ReminderNotification) => void;

export class ReminderTracker {
  private reminders: Map<string, TrackedReminder> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private onNotification: ReminderCallback | null = null;
  private isRunning = false;
  
  // Notification thresholds (in minutes) - ONLY urgent ones that need immediate attention
  private readonly THRESHOLDS = [
    { minutes: 0, urgency: 'overdue' as const, message: 'is overdue', repeatEvery: 60000 }, // Repeat every 60 seconds for overdue
    { minutes: 1, urgency: 'urgent' as const, message: 'is due in 1 minute!' },
    { minutes: 5, urgency: 'urgent' as const, message: 'is due in 5 minutes!' },
  ];
  
  // Track last overdue notification time to avoid spamming
  private lastOverdueNotification: Map<string, number> = new Map();
  
  constructor() {
    // Initialize
  }
  
  /**
   * Start tracking reminders
   */
  start(onNotification: ReminderCallback): void {
    if (this.isRunning) return;
    
    this.onNotification = onNotification;
    this.isRunning = true;
    
    // Check every 30 seconds
    this.checkInterval = setInterval(() => this.checkReminders(), 30000);
    
    // Initial check
    this.checkReminders();
    
    console.log('[ReminderTracker] Started');
  }
  
  /**
   * Stop tracking
   */
  stop(): void {
    this.isRunning = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    console.log('[ReminderTracker] Stopped');
  }
  
  /**
   * Update the list of reminders to track
   */
  updateReminders(reminders: Array<{
    _id: string;
    title: string;
    description?: string;
    dueDate: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    status: string;
  }>): void {
    // Keep existing notification state for reminders that still exist
    const newReminders = new Map<string, TrackedReminder>();
    
    for (const r of reminders) {
      if (r.status === 'completed') continue; // Skip completed
      
      const existing = this.reminders.get(r._id);
      newReminders.set(r._id, {
        _id: r._id,
        title: r.title,
        description: r.description,
        dueDate: new Date(r.dueDate),
        priority: r.priority,
        status: r.status,
        notifiedTimes: existing?.notifiedTimes || new Set(),
      });
    }
    
    this.reminders = newReminders;
  }
  
  /**
   * Add a single reminder to track
   */
  addReminder(reminder: {
    _id: string;
    title: string;
    description?: string;
    dueDate: string | Date;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    status: string;
  }): void {
    if (reminder.status === 'completed') return;
    
    this.reminders.set(reminder._id, {
      ...reminder,
      dueDate: new Date(reminder.dueDate),
      notifiedTimes: new Set(),
    });
  }
  
  /**
   * Remove a reminder from tracking
   */
  removeReminder(id: string): void {
    this.reminders.delete(id);
    this.lastOverdueNotification.delete(id);
  }
  
  /**
   * Mark reminder as completed (removes from tracking)
   */
  completeReminder(id: string): void {
    this.reminders.delete(id);
    this.lastOverdueNotification.delete(id);
  }
  
  /**
   * Get upcoming reminders summary
   */
  getUpcomingSummary(): { urgent: number; warning: number; total: number } {
    const now = new Date();
    let urgent = 0;
    let warning = 0;
    let total = 0;
    
    for (const reminder of this.reminders.values()) {
      const diff = reminder.dueDate.getTime() - now.getTime();
      const minutesLeft = diff / (1000 * 60);
      
      total++;
      if (minutesLeft <= 0 || minutesLeft <= 15) {
        urgent++;
      } else if (minutesLeft <= 60) {
        warning++;
      }
    }
    
    return { urgent, warning, total };
  }
  
  /**
   * Check all reminders and emit notifications
   * Only notifies for urgent (5 mins or less) and overdue reminders
   * Keeps re-notifying for overdue until marked done
   */
  private checkReminders(): void {
    if (!this.isRunning) return;
    
    const now = new Date();
    
    for (const reminder of this.reminders.values()) {
      const diff = reminder.dueDate.getTime() - now.getTime();
      const minutesLeft = diff / (1000 * 60);
      
      // Handle OVERDUE reminders - keep reminding until done
      if (minutesLeft <= 0) {
        const lastNotified = this.lastOverdueNotification.get(reminder._id) || 0;
        const timeSinceLastNotification = now.getTime() - lastNotified;
        
        // Re-notify every 60 seconds for overdue reminders
        if (timeSinceLastNotification >= 60000) {
          this.lastOverdueNotification.set(reminder._id, now.getTime());
          
          const overdueMinutes = Math.abs(minutesLeft);
          let humanMessage = '';
          if (overdueMinutes < 1) {
            humanMessage = 'was just due';
          } else if (overdueMinutes < 60) {
            humanMessage = `was due ${Math.floor(overdueMinutes)} minutes ago`;
          } else {
            humanMessage = `was due ${Math.floor(overdueMinutes / 60)} hours ago`;
          }
          
          this.emitNotification({
            id: `${reminder._id}-overdue-${now.getTime()}`,
            title: reminder.title,
            message: humanMessage,
            urgency: 'overdue',
            timeLeft: this.formatTimeLeft(minutesLeft),
            reminder,
          });
        }
        continue; // Skip other threshold checks for overdue
      }
      
      // Handle upcoming reminders (5 mins or less)
      for (const threshold of this.THRESHOLDS) {
        if (threshold.minutes === 0) continue; // Skip overdue threshold, handled above
        
        // Check if we're within this threshold
        const isWithinThreshold = minutesLeft <= threshold.minutes && 
          minutesLeft > (this.THRESHOLDS.find(t => t.minutes < threshold.minutes && t.minutes > 0)?.minutes ?? 0);
        
        if (isWithinThreshold) {
          const thresholdKey = `${threshold.minutes}`;
          
          // Only notify once per threshold
          if (!reminder.notifiedTimes.has(thresholdKey)) {
            reminder.notifiedTimes.add(thresholdKey);
            
            this.emitNotification({
              id: `${reminder._id}-${threshold.minutes}`,
              title: reminder.title,
              message: threshold.message,
              urgency: threshold.urgency,
              timeLeft: this.formatTimeLeft(minutesLeft),
              reminder,
            });
          }
          
          break; // Only match one threshold
        }
      }
    }
  }
  
  /**
   * Format time remaining
   */
  private formatTimeLeft(minutes: number): string {
    if (minutes < 0) {
      const overdue = Math.abs(minutes);
      if (overdue < 60) return `${Math.floor(overdue)}m overdue`;
      if (overdue < 1440) return `${Math.floor(overdue / 60)}h overdue`;
      return `${Math.floor(overdue / 1440)}d overdue`;
    }
    
    if (minutes < 1) return 'now';
    if (minutes < 60) return `${Math.floor(minutes)}m`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${Math.floor(minutes % 60)}m`;
    return `${Math.floor(minutes / 1440)}d`;
  }
  
  /**
   * Emit notification
   */
  private emitNotification(notification: ReminderNotification): void {
    console.log('[ReminderTracker] Notification:', notification);
    
    if (this.onNotification) {
      this.onNotification(notification);
    }
    
    // Also try browser notification if permitted
    this.showBrowserNotification(notification);
  }
  
  /**
   * Show browser notification
   */
  private async showBrowserNotification(notification: ReminderNotification): Promise<void> {
    if (typeof window === 'undefined') return;
    if (!('Notification' in window)) return;
    
    try {
      if (Notification.permission === 'granted') {
        new Notification(`⏰ ${notification.title}`, {
          body: notification.message,
          icon: '/icons/favicon.png',
          tag: notification.id,
          requireInteraction: notification.urgency === 'urgent' || notification.urgency === 'overdue',
        });
      } else if (Notification.permission !== 'denied') {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          this.showBrowserNotification(notification);
        }
      }
    } catch (error) {
      console.error('[ReminderTracker] Browser notification failed:', error);
    }
  }
}

// Singleton
let trackerInstance: ReminderTracker | null = null;

export function getReminderTracker(): ReminderTracker {
  if (!trackerInstance) {
    trackerInstance = new ReminderTracker();
  }
  return trackerInstance;
}

export function resetReminderTracker(): void {
  if (trackerInstance) {
    trackerInstance.stop();
    trackerInstance = null;
  }
}
