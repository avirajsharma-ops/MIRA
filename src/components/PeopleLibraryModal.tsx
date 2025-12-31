'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Modal from './Modal';

interface Person {
  id: string;
  name: string;
  relationship?: string;
  distinctiveFeatures?: string[];
  context?: string;
  notes?: string[];
  learnedInfo?: string[];
  firstSeen?: string;
  lastSeen?: string;
  seenCount?: number;
  isOwner?: boolean;
}

interface PeopleLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function PeopleLibraryModal({ isOpen, onClose }: PeopleLibraryModalProps) {
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', relationship: '', context: '' });

  const fetchPeople = useCallback(async () => {
    if (!isOpen) return;
    
    try {
      setLoading(true);
      setError(null);
      const token = localStorage.getItem('mira_token');
      
      const response = await fetch('/api/people', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setPeople(data.people || []);
      } else {
        setError('Failed to load people');
      }
    } catch (err) {
      setError('Error loading people');
    } finally {
      setLoading(false);
    }
  }, [isOpen]);

  useEffect(() => {
    fetchPeople();
  }, [fetchPeople]);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this person?')) return;
    
    try {
      const token = localStorage.getItem('mira_token');
      const response = await fetch(`/api/people?personId=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        setPeople(people.filter(p => p.id !== id));
        if (selectedPerson?.id === id) setSelectedPerson(null);
      } else {
        const errorData = await response.json();
        console.error('Delete failed:', errorData.error);
        alert('Failed to delete person: ' + (errorData.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Delete error:', err);
      alert('Error deleting person');
    }
  };

  const handleUpdate = async () => {
    if (!selectedPerson) return;
    
    try {
      const token = localStorage.getItem('mira_token');
      const response = await fetch('/api/people', {
        method: 'PUT',
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personId: selectedPerson.id,
          updates: editForm,
        }),
      });

      if (response.ok) {
        await fetchPeople();
        setEditMode(false);
      }
    } catch (err) {
      console.error('Update error:', err);
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="People Library" size="xl">
      <div className="flex gap-6 min-h-[400px]">
        {/* People List */}
        <div className="w-1/2 border-r border-white/10 pr-6">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm text-white/50">{people.length} people recognized</span>
            <button
              onClick={fetchPeople}
              className="text-sm text-purple-400 hover:text-purple-300 transition-colors"
            >
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-400">
              {error}
            </div>
          ) : people.length === 0 ? (
            <div className="text-center py-12 text-white/40">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <p className="text-sm">No people recognized yet</p>
              <p className="text-xs mt-2 text-white/30">MIRA will remember people as you talk</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {people.map((person) => (
                <button
                  key={person.id}
                  onClick={() => {
                    setSelectedPerson(person);
                    setEditForm({
                      name: person.name,
                      relationship: person.relationship || '',
                      context: person.context || '',
                    });
                    setEditMode(false);
                  }}
                  className={`w-full text-left p-3 rounded-lg transition-colors ${
                    selectedPerson?.id === person.id
                      ? 'bg-purple-500/20 border border-purple-500/50'
                      : 'bg-white/5 hover:bg-white/10 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-semibold ${
                      person.isOwner 
                        ? 'bg-gradient-to-br from-purple-500 to-cyan-500 text-white'
                        : 'bg-white/20 text-white/70'
                    }`}>
                      {person.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white truncate">{person.name}</span>
                        {person.isOwner && (
                          <span className="text-xs px-1.5 py-0.5 bg-purple-500/30 text-purple-300 rounded">Owner</span>
                        )}
                      </div>
                      {person.relationship && (
                        <span className="text-sm text-white/50 truncate block">{person.relationship}</span>
                      )}
                    </div>
                    <span className="text-xs text-white/30">{person.seenCount || 0}x</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Person Details */}
        <div className="w-1/2 pl-2">
          {selectedPerson ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl font-bold ${
                    selectedPerson.isOwner 
                      ? 'bg-gradient-to-br from-purple-500 to-cyan-500 text-white'
                      : 'bg-white/20 text-white/70'
                  }`}>
                    {selectedPerson.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    {editMode ? (
                      <input
                        type="text"
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        className="bg-white/10 border border-white/20 rounded px-2 py-1 text-white text-lg font-semibold w-full"
                      />
                    ) : (
                      <h3 className="text-lg font-semibold text-white">{selectedPerson.name}</h3>
                    )}
                    {editMode ? (
                      <input
                        type="text"
                        value={editForm.relationship}
                        onChange={(e) => setEditForm({ ...editForm, relationship: e.target.value })}
                        placeholder="Relationship (e.g., Friend, Family)"
                        className="bg-white/10 border border-white/20 rounded px-2 py-1 text-white/70 text-sm w-full mt-1"
                      />
                    ) : (
                      <p className="text-sm text-white/50">{selectedPerson.relationship || 'No relationship set'}</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  {editMode ? (
                    <>
                      <button
                        onClick={handleUpdate}
                        className="px-3 py-1.5 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded-lg text-sm transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditMode(false)}
                        className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white/70 rounded-lg text-sm transition-colors"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setEditMode(true)}
                        className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white/70 rounded-lg text-sm transition-colors"
                      >
                        Edit
                      </button>
                      {!selectedPerson.isOwner && (
                        <button
                          onClick={() => handleDelete(selectedPerson.id)}
                          className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-sm transition-colors"
                        >
                          Delete
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="bg-white/5 rounded-lg p-3">
                  <span className="text-white/40 block mb-1">First Seen</span>
                  <span className="text-white/80">{formatDate(selectedPerson.firstSeen)}</span>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <span className="text-white/40 block mb-1">Last Seen</span>
                  <span className="text-white/80">{formatDate(selectedPerson.lastSeen)}</span>
                </div>
              </div>

              {/* Context */}
              <div>
                <span className="text-sm text-white/40 block mb-2">Context / Notes</span>
                {editMode ? (
                  <textarea
                    value={editForm.context}
                    onChange={(e) => setEditForm({ ...editForm, context: e.target.value })}
                    placeholder="Add context about this person..."
                    className="w-full bg-white/5 border border-white/20 rounded-lg p-3 text-white/80 text-sm resize-none h-20"
                  />
                ) : (
                  <div className="bg-white/5 rounded-lg p-3 text-white/70 text-sm">
                    {selectedPerson.context || 'No context added'}
                  </div>
                )}
              </div>

              {/* Learned Info */}
              {selectedPerson.learnedInfo && selectedPerson.learnedInfo.length > 0 && (
                <div>
                  <span className="text-sm text-white/40 block mb-2">Things MIRA Learned</span>
                  <div className="bg-white/5 rounded-lg p-3 space-y-2">
                    {selectedPerson.learnedInfo.map((info, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-sm text-white/70">
                        <span className="text-purple-400">•</span>
                        {info}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Distinctive Features */}
              {selectedPerson.distinctiveFeatures && selectedPerson.distinctiveFeatures.length > 0 && (
                <div>
                  <span className="text-sm text-white/40 block mb-2">Distinctive Features</span>
                  <div className="flex flex-wrap gap-2">
                    {selectedPerson.distinctiveFeatures.map((feature, idx) => (
                      <span key={idx} className="px-2 py-1 bg-cyan-500/20 text-cyan-300 rounded text-xs">
                        {feature}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-white/40">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-16 h-16 mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <p className="text-sm">Select a person to view details</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
