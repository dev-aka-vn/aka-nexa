/**
 * The user autocomplete (ACL-02, BLD-07, BLD-09).
 *
 * Role assignment targets a **user** — never a group or
 * attribute (ACL-02: RBAC is scoped to `real_user_id`
 * only). The control searches the identity directory by
 * name or email **prefix** (`GET /users/search?q=`),
 * resolves the match to its opaque `real_user_id`, and
 * hands the resolved user to the parent.
 *
 * Failures are inline and specific (BLD-07): a search
 * that finds nothing reports an error **echoing the
 * typed string**; the searching state shows a skeleton
 * (BLD-09).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ReactElement } from 'react';

import type { ApiClient } from '../api/client.js';
import {
  UsersSearchSchema,
  type DirectoryUser,
} from '../api/users.js';
import { Skeleton } from '../ui/Skeleton.js';

export interface UserAutocompleteProps {
  /** The API client (the session rides the cookie). */
  client: ApiClient;
  /** The resolved user, handed to the parent. */
  onSelect: (user: DirectoryUser) => void;
  placeholder?: string;
  /** The input's test id (the host surface names it). */
  inputTestId?: string;
}

/** The prefix length that triggers a search. */
const MIN_QUERY_LENGTH = 2;

/**
 * The autocomplete. The input holds the typed query
 * until a match is picked; picking a match resolves
 * the control to the user's name and reports the
 * full user record (with its real_user_id) upward.
 */
export function UserAutocomplete({
  client,
  onSelect,
  placeholder = 'Search by name or email…',
  inputTestId = 'autocomplete-input',
}: UserAutocompleteProps): ReactElement {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<DirectoryUser | null>(
    null,
  );
  const [results, setResults] = useState<readonly DirectoryUser[]>(
    [],
  );
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const searchId = useRef(0);

  const search = useCallback(
    async (rawQuery: string): Promise<void> => {
      const needle = rawQuery.trim();
      // Stale-response guard: only the latest search wins.
      const id = ++searchId.current;
      setSearching(true);
      setError(null);
      setResults([]);
      try {
        const response = await client.get(
          `/users/search?q=${encodeURIComponent(needle)}`,
          UsersSearchSchema,
        );
        if (id !== searchId.current) {
          return;
        }
        setResults(response.users);
        // BLD-07: a no-match is an inline error echoing
        // the typed string — never a silent empty list.
        if (response.users.length === 0) {
          setError(`No users match "${rawQuery.trim()}"`);
        }
      } catch (searchError) {
        if (id !== searchId.current) {
          return;
        }
        setError(
          searchError instanceof Error
            ? searchError.message
            : String(searchError),
        );
      } finally {
        if (id === searchId.current) {
          setSearching(false);
        }
      }
    },
    [client],
  );

  // Debounce the prefix search.
  useEffect(() => {
    const needle = query.trim();
    if (needle.length < MIN_QUERY_LENGTH) {
      searchId.current += 1; // invalidate in-flight searches
      setResults([]);
      setError(null);
      setSearching(false);
      return;
    }
    const timer = setTimeout(() => {
      void search(query);
    }, 200);
    return () => {
      clearTimeout(timer);
    };
  }, [query, search]);

  const pick = (user: DirectoryUser): void => {
    setSelected(user);
    setQuery(user.name);
    setResults([]);
    setError(null);
    setOpen(false);
    onSelect(user);
  };

  const onInput = (value: string): void => {
    // Typing again clears the resolution — the parent
    // must re-pick before assigning.
    setSelected(null);
    setQuery(value);
    setOpen(true);
  };

  const showDropdown =
    open && (searching || results.length > 0 || error !== null);

  return (
    <div data-testid="user-autocomplete" style={{ position: 'relative' }}>
      <input
        type="text"
        className="input"
        data-testid={inputTestId}
        value={query}
        placeholder={placeholder}
        autoComplete="off"
        aria-label="Assign user"
        onChange={(event) => onInput(event.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay so a click on an option registers first.
          setTimeout(() => setOpen(false), 150);
        }}
        style={{ width: '100%' }}
      />
      {showDropdown ? (
        <div
          data-testid="autocomplete-dropdown"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 20,
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-md)',
            marginTop: 4,
            maxHeight: 240,
            overflowY: 'auto',
          }}
        >
          {searching ? (
            <div style={{ padding: 8 }}>
              <Skeleton variant="text" lines={2} label="Searching the directory" />
            </div>
          ) : null}
          {results.map((user) => (
            <button
              type="button"
              key={user.real_user_id}
              data-testid={`user-option-${user.real_user_id}`}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(user);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                border: 'none',
                background: 'none',
                padding: '8px 12px',
                cursor: 'pointer',
                borderBottom: '1px solid var(--line)',
              }}
            >
              <span style={{ display: 'block', fontSize: 14 }}>
                {user.name}
              </span>
              <span
                className="lr-s"
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 11.5,
                  color: 'var(--muted)',
                }}
              >
                {user.email} · {user.real_user_id}
              </span>
            </button>
          ))}
          {error && !searching ? (
            <div
              data-testid="autocomplete-error"
              role="alert"
              style={{
                padding: '8px 12px',
                color: 'var(--red)',
                fontSize: 13,
              }}
            >
              {error}
            </div>
          ) : null}
        </div>
      ) : null}
      {selected ? (
        <span
          className="helper"
          data-testid="autocomplete-resolved"
          style={{ display: 'block', marginTop: 4 }}
        >
          Resolves to {selected.real_user_id}
        </span>
      ) : null}
    </div>
  );
}
