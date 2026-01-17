'use client';

import React, { useState, useEffect } from 'react';

interface Person {
  _id: string;
  name: string;
  description: string;
  relationship?: string;
  tags: string[];
  createdAt: string;
}

interface PeopleLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function PeopleLibraryModal({ isOpen, onClose }: PeopleLibraryModalProps) {
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [relationship, setRelationship] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchPeople();
    }
  }, [isOpen]);

  const fetchPeople = async () => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('mira_auth_token');
      const params = searchQuery ? `?search=${encodeURIComponent(searchQuery)}` : '';
      const response = await fetch(`/api/people${params}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setPeople(data.people || []);
      } else {
        setError('Failed to load people');
      }
    } catch (err) {
      setError('Failed to load people');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchPeople();
  };

  const handleAddPerson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !description.trim()) return;

    setSaving(true);
    setError('');
    try {
      const token = localStorage.getItem('mira_auth_token');
      const response = await fetch('/api/people', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          relationship: relationship.trim() || undefined,
        }),
      });

      if (response.ok) {
        setName('');
        setDescription('');
        setRelationship('');
        setShowAddForm(false);
        fetchPeople();
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to add person');
      }
    } catch (err) {
      setError('Failed to add person');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (personId: string, personName: string) => {
    if (!confirm(`Are you sure you want to delete ${personName}?`)) return;

    try {
      const token = localStorage.getItem('mira_auth_token');
      const response = await fetch(`/api/people?id=${personId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        fetchPeople();
      } else {
        setError('Failed to delete person');
      }
    } catch (err) {
      setError('Failed to delete person');
      console.error(err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-white">People Library</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search bar */}
        <form onSubmit={handleSearch} className="mb-4 flex gap-2">
          <input
            type="text"
            placeholder="Search people..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
          >
            Search
          </button>
          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors"
          >
            {showAddForm ? 'Cancel' : 'Add Person'}
          </button>
        </form>

        {/* Add person form */}
        {showAddForm && (
          <form onSubmit={handleAddPerson} className="mb-4 p-4 bg-gray-800 rounded-lg border border-gray-700">
            <div className="mb-3">
              <label className="block text-sm text-gray-400 mb-1">Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., John Smith"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                required
              />
            </div>
            <div className="mb-3">
              <label className="block text-sm text-gray-400 mb-1">Description *</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., My colleague at TechCorp, works in engineering, likes hiking"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
                rows={2}
                required
              />
            </div>
            <div className="mb-3">
              <label className="block text-sm text-gray-400 mb-1">Relationship</label>
              <input
                type="text"
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                placeholder="e.g., colleague, friend, family"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={saving || !name.trim() || !description.trim()}
              className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white py-2 rounded-lg transition-colors"
            >
              {saving ? 'Saving...' : 'Save Person'}
            </button>
          </form>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* People list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="text-center text-gray-400 py-8">Loading...</div>
          ) : people.length === 0 ? (
            <div className="text-center text-gray-400 py-8">
              <p>No people saved yet.</p>
              <p className="text-sm mt-2">Add people to help MIRA remember who&apos;s important to you!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {people.map((person) => (
                <div
                  key={person._id}
                  className="bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition-colors"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h3 className="text-white font-medium">{person.name}</h3>
                      {person.relationship && (
                        <span className="inline-block mt-1 text-xs bg-blue-900/50 text-blue-300 px-2 py-0.5 rounded">
                          {person.relationship}
                        </span>
                      )}
                      <p className="text-gray-400 text-sm mt-2">{person.description}</p>
                    </div>
                    <button
                      onClick={() => handleDelete(person._id, person.name)}
                      className="text-gray-500 hover:text-red-400 transition-colors ml-2"
                      title="Delete person"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-gray-700 text-center">
          <p className="text-xs text-gray-500">
            People you add here will be available in MIRA&apos;s memory for context in conversations.
          </p>
        </div>
      </div>
    </div>
  );
}
