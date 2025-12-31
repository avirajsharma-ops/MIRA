'use client';

import { useState } from 'react';
import { useMIRA } from '@/context/MIRAContext';

export default function AuthScreen() {
  const { login, register } = useMIRA();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      let success;
      if (isLogin) {
        success = await login(email, password);
      } else {
        if (!name.trim()) {
          setError('Name is required');
          setIsLoading(false);
          return;
        }
        success = await register(email, password, name);
      }

      if (!success) {
        setError(isLogin ? 'Invalid credentials' : 'Registration failed');
      }
    } catch {
      setError('An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-2">
            <img src="/icons/favicon.png" alt="MIRA" className="w-14 h-14 rounded-xl" />
            <h1 className="text-5xl font-bold text-white">
              MIRA
            </h1>
          </div>
          <p className="text-white/50 mt-2">
            Your Intelligent AI Companion
          </p>
        </div>

        {/* Form */}
        <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-8 border border-white/10 bg-black/40">
          <h2 className="text-2xl font-semibold text-white mb-6">
            {isLogin ? 'Welcome Back' : 'Create Account'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div>
                <label className="block text-sm text-white/70 mb-2">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50"
                />
              </div>
            )}

            <div>
              <label className="block text-sm text-white/70 mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50"
              />
            </div>

            <div>
              <label className="block text-sm text-white/70 mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50"
              />
            </div>

            {error && (
              <p className="text-red-400 text-sm">{error}</p>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-white text-black py-3 rounded-xl font-semibold hover:bg-white/90 transition-opacity disabled:opacity-50"
            >
              {isLoading ? 'Loading...' : isLogin ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => {
                setIsLogin(!isLogin);
                setError('');
              }}
              className="text-white/50 hover:text-white transition-colors"
            >
              {isLogin
                ? "Don't have an account? Sign up"
                : 'Already have an account? Sign in'}
            </button>
          </div>
        </div>

        {/* Info */}
        <div className="mt-8 text-center text-white/30 text-sm">
          <p>✨ Always here to help</p>
          <p>🎯 Smart, intuitive, and personal</p>
        </div>
      </div>
    </div>
  );
}
