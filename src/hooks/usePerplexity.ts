import { useState, useCallback } from 'react';

interface PerplexityConfig {
  onResponse?: (text: string) => void;
  onError?: (error: string) => void;
}

export function usePerplexity(config: PerplexityConfig = {}) {
  const [status, setStatus] = useState<'idle' | 'processing' | 'error'>('idle');
  const [lastResponse, setLastResponse] = useState('');

  const processQuery = useCallback(async (text: string) => {
    setStatus('processing');
    try {
      const response = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.NEXT_PUBLIC_PERPLEXITY_API_KEY || ''}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.1-sonar-small-128k-online',
          messages: [
            { role: 'system', content: 'You are MIRA. Be concise.' },
            { role: 'user', content: text }
          ]
        })
      });

      if (!response.ok) throw new Error('Perplexity API failed');

      const data = await response.json();
      const content = data.choices[0]?.message?.content || '';
      
      setLastResponse(content);
      config.onResponse?.(content);
      setStatus('idle');
      
      return content;
    } catch (err: any) {
      console.error('Perplexity Error:', err);
      setStatus('error');
      config.onError?.(err.message);
      throw err;
    }
  }, [config]);

  return {
    processQuery,
    status,
    lastResponse
  };
}
