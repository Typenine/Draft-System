'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { LEAGUE_IDS } from '@/lib/constants/league';
import { getTeamsData, TeamData } from '@/lib/utils/sleeper-api';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';

// Define search result types
type SearchResultItem = {
  title: string;
  path: string;
  type: 'team' | 'page' | 'trade' | 'rule';
  description?: string;
};

// Define search categories
const searchablePages = [
  { title: 'Home', path: '/', type: 'page' as const },
  { title: 'Teams', path: '/teams', type: 'page' as const },
  { title: 'Standings', path: '/standings', type: 'page' as const },
  { title: 'Rules', path: '/rules', type: 'page' as const },
  { title: 'History', path: '/history', type: 'page' as const },
  { title: 'Draft', path: '/draft', type: 'page' as const },
  { title: 'Newsletter', path: '/newsletter', type: 'page' as const },
  { title: 'Trades', path: '/trades', type: 'page' as const },
  { title: 'Trade Trees', path: '/trades/trees', type: 'page' as const },
];

export default function GlobalSearch() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [teams, setTeams] = useState<TeamData[]>([]);

  // Load current season teams for accurate canonical names and roster links
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getTeamsData(LEAGUE_IDS.CURRENT);
        if (!cancelled) setTeams(data);
      } catch {
        // swallow; search will still work for pages
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Handle search query changes
  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      return;
    }

    // Search logic
    const searchResults: SearchResultItem[] = [];
    const lowerQuery = query.toLowerCase();

    // Search teams (live, canonical, correct roster IDs)
    teams.forEach((t) => {
      const name = t.teamName;
      if (name.toLowerCase().includes(lowerQuery)) {
        searchResults.push({
          title: name,
          path: `/teams/${t.rosterId}`,
          type: 'team',
          description: 'Team Page'
        });
      }
    });

    // Search pages
    searchablePages.forEach(page => {
      if (page.title.toLowerCase().includes(lowerQuery)) {
        searchResults.push({
          title: page.title,
          path: page.path,
          type: 'page',
          description: 'Page'
        });
      }
    });

    // Limit results to top 10
    setResults(searchResults.slice(0, 10));
    setSelectedIndex(0);
  }, [query, teams]);

  // (Overlay click is handled by Modal)

  // Handle keyboard shortcuts and navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+K or Cmd+K to open search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(prev => !prev);
        if (!isOpen && inputRef.current) {
          setTimeout(() => {
            inputRef.current?.focus();
          }, 100);
        }
      }

      // Escape to close search
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }

      // Arrow navigation for results
      if (isOpen && results.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex(prev => (prev < results.length - 1 ? prev + 1 : prev));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex(prev => (prev > 0 ? prev - 1 : prev));
        } else if (e.key === 'Enter' && selectedIndex >= 0) {
          e.preventDefault();
          window.location.href = results[selectedIndex].path;
          setIsOpen(false);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, results, selectedIndex]);

  // Focus input when search opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  return (
    <div className="relative">
      {/* Search trigger */}
      <Button
        variant="ghost"
        size="sm"
        aria-label="Open search"
        onClick={() => setIsOpen(true)}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <span className="ml-2 hidden md:inline">Search</span>
        <span className="ml-2 hidden md:inline text-xs text-[var(--muted)]">(Ctrl+K)</span>
      </Button>

      {/* Search modal */}
      <Modal open={isOpen} onClose={() => setIsOpen(false)} title="Search East v West">
        <div role="combobox" aria-expanded={true} aria-controls="search-results" aria-haspopup="listbox">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-[var(--muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <Input
              ref={inputRef}
              type="text"
              placeholder="Search teams, pages, and more..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-autocomplete="list"
              aria-controls="search-results"
            />
            <Button variant="ghost" aria-label="Close search" onClick={() => setIsOpen(false)}>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </Button>
          </div>

          <div id="search-results" className="max-h-96 overflow-y-auto p-2 mt-3" role="listbox" aria-labelledby="search-heading">
            {results.length > 0 ? (
              <div className="space-y-1">
                {results.map((result, index) => (
                  <Link
                    key={`${result.type}-${result.path}`}
                    href={result.path}
                    onClick={() => setIsOpen(false)}
                    className={`flex items-center gap-3 p-3 rounded-md transition-colors ${
                      index === selectedIndex
                        ? 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] border border-[var(--border)]'
                        : 'hover:bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]'
                    }`}
                    role="option"
                    aria-selected={index === selectedIndex}
                    tabIndex={0}
                  >
                    {result.type === 'team' && (
                      <span className="bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--text)] p-1 rounded">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                      </span>
                    )}
                    {result.type === 'page' && (
                      <span className="bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--text)] p-1 rounded">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </span>
                    )}
                    <div>
                      <div className="font-medium">{result.title}</div>
                      <div className="text-sm text-[var(--muted)]">{result.description}</div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : query.length >= 2 ? (
              <div className="px-4 py-8 text-center text-[var(--muted)]" role="status">
                No results found for &quot;{query}&quot;
              </div>
            ) : (
              <div className="px-4 py-8 text-center text-[var(--muted)]">
                Type at least 2 characters to search
              </div>
            )}
          </div>

          <div className="evw-muted px-4 py-3 text-xs text-[var(--muted)] flex justify-between mt-2 rounded-[var(--radius-card)]">
            <div>
              <span className="bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] px-2 py-1 rounded">↑↓</span> to navigate
            </div>
            <div>
              <span className="bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] px-2 py-1 rounded">Enter</span> to select
            </div>
            <div>
              <span className="bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] px-2 py-1 rounded">Esc</span> to close
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
