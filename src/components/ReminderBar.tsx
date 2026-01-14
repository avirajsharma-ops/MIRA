'use client';

import { useState, useEffect, useCallback } from 'react';

interface Reminder {
  _id: string;
  title: string;
  description?: string;
  dueDate: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'in-progress' | 'completed' | 'overdue' | 'snoozed';
  category?: string;
  source: string;
}

interface ReminderBarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ReminderBar({ isOpen, onClose }: ReminderBarProps) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'overdue' | 'upcoming'>('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newReminder, setNewReminder] = useState<{
    title: string;
    description: string;
    dueDate: string;
    dueTime: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
  }>({
    title: '',
    description: '',
    dueDate: '',
    dueTime: '',
    priority: 'medium',
  });

  // Fetch reminders
  const fetchReminders = useCallback(async () => {
    setIsLoading(true);
    try {
      const token = localStorage.getItem('mira_token');
      let url = '/api/reminders';
      
      if (filter === 'overdue') {
        url += '?overdue=true';
      } else if (filter === 'upcoming') {
        url += '?upcoming=true';
      } else if (filter === 'pending') {
        url += '?status=pending';
      }
      
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (response.ok) {
        const data = await response.json();
        setReminders(data.reminders || []);
      }
    } catch (error) {
      console.error('Failed to fetch reminders:', error);
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (isOpen) {
      fetchReminders();
    }
  }, [isOpen, fetchReminders]);

  // Create reminder
  const createReminder = async () => {
    if (!newReminder.title || !newReminder.dueDate) return;
    
    try {
      const token = localStorage.getItem('mira_token');
      const dueDateTime = newReminder.dueTime 
        ? `${newReminder.dueDate}T${newReminder.dueTime}` 
        : `${newReminder.dueDate}T23:59`;
      
      const response = await fetch('/api/reminders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: newReminder.title,
          description: newReminder.description,
          dueDate: new Date(dueDateTime).toISOString(),
          priority: newReminder.priority,
        }),
      });
      
      if (response.ok) {
        setNewReminder({ title: '', description: '', dueDate: '', dueTime: '', priority: 'medium' });
        setShowAddForm(false);
        fetchReminders();
      }
    } catch (error) {
      console.error('Failed to create reminder:', error);
    }
  };

  // Complete reminder
  const completeReminder = async (id: string) => {
    try {
      const token = localStorage.getItem('mira_token');
      await fetch('/api/reminders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id, status: 'completed' }),
      });
      fetchReminders();
    } catch (error) {
      console.error('Failed to complete reminder:', error);
    }
  };

  // Snooze reminder
  const snoozeReminder = async (id: string, minutes: number) => {
    try {
      const token = localStorage.getItem('mira_token');
      await fetch('/api/reminders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id, snooze: minutes }),
      });
      fetchReminders();
    } catch (error) {
      console.error('Failed to snooze reminder:', error);
    }
  };

  // Delete reminder
  const deleteReminder = async (id: string) => {
    try {
      const token = localStorage.getItem('mira_token');
      await fetch(`/api/reminders?id=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchReminders();
    } catch (error) {
      console.error('Failed to delete reminder:', error);
    }
  };

  // Format due date
  const formatDueDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const diffDays = Math.floor(diff / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(diff / (1000 * 60 * 60));
    const diffMinutes = Math.floor(diff / (1000 * 60));
    
    if (diff < 0) {
      return { text: 'Overdue', color: 'text-red-400', urgent: true };
    } else if (diffMinutes < 60) {
      return { text: `${diffMinutes}m left`, color: 'text-orange-400', urgent: true };
    } else if (diffHours < 24) {
      return { text: `${diffHours}h left`, color: 'text-yellow-400', urgent: diffHours < 2 };
    } else if (diffDays < 7) {
      return { text: `${diffDays}d left`, color: 'text-blue-400', urgent: false };
    } else {
      return { text: date.toLocaleDateString(), color: 'text-white/60', urgent: false };
    }
  };

  // Priority colors
  const priorityColors = {
    low: 'border-gray-500/30 bg-gray-500/10',
    medium: 'border-blue-500/30 bg-blue-500/10',
    high: 'border-orange-500/30 bg-orange-500/10',
    urgent: 'border-red-500/30 bg-red-500/10 animate-pulse',
  };

  const priorityBadge = {
    low: 'bg-gray-500/20 text-gray-400',
    medium: 'bg-blue-500/20 text-blue-400',
    high: 'bg-orange-500/20 text-orange-400',
    urgent: 'bg-red-500/20 text-red-400',
  };

  if (!isOpen) return null;

  return (
    <div className="fixed left-4 top-16 bottom-20 w-80 sm:w-96 z-[55] bg-black/90 border border-white/20 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
            <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <path d="M16 10a4 4 0 0 1-8 0" />
          </svg>
          <span className="text-white font-medium">Reminders</span>
          <span className="text-white/40 text-xs">({reminders.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-emerald-400"
            title="Add Reminder"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/60">
              <path d="M18 6L6 18" />
              <path d="M6 6L18 18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-white/10">
        {(['all', 'pending', 'upcoming', 'overdue'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2 py-1 rounded-lg text-xs transition-colors capitalize ${
              filter === f 
                ? 'bg-amber-500/20 text-amber-400' 
                : 'text-white/50 hover:text-white/80 hover:bg-white/5'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="p-3 border-b border-white/10 bg-white/5">
          <input
            type="text"
            placeholder="What do you need to remember?"
            value={newReminder.title}
            onChange={(e) => setNewReminder(prev => ({ ...prev, title: e.target.value }))}
            className="w-full px-3 py-2 bg-black/50 border border-white/20 rounded-lg text-white text-sm placeholder:text-white/40 focus:outline-none focus:border-amber-500/50 mb-2"
          />
          <textarea
            placeholder="Description (optional)"
            value={newReminder.description}
            onChange={(e) => setNewReminder(prev => ({ ...prev, description: e.target.value }))}
            className="w-full px-3 py-2 bg-black/50 border border-white/20 rounded-lg text-white text-sm placeholder:text-white/40 focus:outline-none focus:border-amber-500/50 mb-2 resize-none h-16"
          />
          <div className="flex gap-2 mb-2">
            <input
              type="date"
              value={newReminder.dueDate}
              onChange={(e) => setNewReminder(prev => ({ ...prev, dueDate: e.target.value }))}
              className="flex-1 px-3 py-2 bg-black/50 border border-white/20 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/50"
            />
            <input
              type="time"
              value={newReminder.dueTime}
              onChange={(e) => setNewReminder(prev => ({ ...prev, dueTime: e.target.value }))}
              className="w-24 px-3 py-2 bg-black/50 border border-white/20 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/50"
            />
          </div>
          <div className="flex gap-2 mb-2">
            {(['low', 'medium', 'high', 'urgent'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setNewReminder(prev => ({ ...prev, priority: p }))}
                className={`flex-1 px-2 py-1.5 rounded-lg text-xs transition-colors capitalize ${
                  newReminder.priority === p 
                    ? priorityBadge[p]
                    : 'bg-white/5 text-white/50 hover:bg-white/10'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <button
            onClick={createReminder}
            disabled={!newReminder.title || !newReminder.dueDate}
            className="w-full py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add Reminder
          </button>
        </div>
      )}

      {/* Reminders list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {isLoading ? (
          <div className="flex items-center justify-center h-20">
            <div className="w-6 h-6 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
          </div>
        ) : reminders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-white/40 text-sm">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mb-3 opacity-50">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
            <p>No reminders yet</p>
            <p className="text-xs mt-1">Ask MIRA to set a reminder or add one above</p>
          </div>
        ) : (
          reminders.map((reminder) => {
            const due = formatDueDate(reminder.dueDate);
            return (
              <div
                key={reminder._id}
                className={`p-3 rounded-xl border ${priorityColors[reminder.priority]} transition-all`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h4 className="text-white text-sm font-medium truncate">{reminder.title}</h4>
                    {reminder.description && (
                      <p className="text-white/50 text-xs mt-1 line-clamp-2">{reminder.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <span className={`text-xs ${due.color}`}>{due.text}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${priorityBadge[reminder.priority]}`}>
                        {reminder.priority}
                      </span>
                      {reminder.source === 'phone_call' && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-400">
                          📞 call
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => completeReminder(reminder._id)}
                      className="p-1.5 hover:bg-green-500/20 rounded-lg transition-colors text-green-400"
                      title="Mark complete"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                    <button
                      onClick={() => snoozeReminder(reminder._id, 15)}
                      className="p-1.5 hover:bg-blue-500/20 rounded-lg transition-colors text-blue-400"
                      title="Snooze 15min"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                    </button>
                    <button
                      onClick={() => deleteReminder(reminder._id)}
                      className="p-1.5 hover:bg-red-500/20 rounded-lg transition-colors text-red-400"
                      title="Delete"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
