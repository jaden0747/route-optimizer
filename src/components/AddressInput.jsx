import { useState } from 'react';

function AddressItem({ index, address, cached, onRemove, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(address);

  const save = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== address) {
      onEdit(index, trimmed);
    } else {
      setDraft(address); // revert if empty or unchanged
    }
    setEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') {
      setDraft(address);
      setEditing(false);
    }
  };

  return (
    <li className="flex items-center gap-2 text-sm bg-gray-50 border border-gray-200 rounded px-2 py-1">
      <span className={`w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold flex-shrink-0 ${cached ? 'bg-green-500 text-white' : 'bg-gray-300 text-gray-700'}`} title={cached ? 'Coordinates saved — geocoding skipped' : ''}>
        {index + 1}
      </span>

      {editing ? (
        <input
          autoFocus
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={save}
          className="flex-1 px-1 py-0.5 text-sm border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      ) : (
        <span
          className="flex-1 truncate text-gray-700 cursor-pointer hover:text-blue-600"
          title="Click to edit"
          onClick={() => {
            setDraft(address);
            setEditing(true);
          }}
        >
          {address}
        </span>
      )}

      {!editing && (
        <button
          onClick={() => onRemove(index)}
          className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0 text-lg leading-none"
          title="Remove"
        >
          ×
        </button>
      )}
    </li>
  );
}

export default function AddressInput({ addresses, cachedSet, onAdd, onRemove, onEdit }) {
  const [input, setInput] = useState('');

  const handleAdd = () => {
    const trimmed = input.trim();
    if (trimmed) {
      onAdd(trimmed);
      setInput('');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleAdd();
  };

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter address (e.g. 1 Apple Park Way, Cupertino, CA)"
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={handleAdd}
          disabled={!input.trim()}
          className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Add
        </button>
      </div>

      {addresses.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No addresses yet. Add some above.</p>
      ) : (
        <>
          <p className="text-xs text-gray-400 mb-1">Click an address to edit it.</p>
          <ul className="space-y-1 max-h-48 overflow-y-auto">
            {addresses.map((addr, i) => (
              <AddressItem
                key={i}
                index={i}
                address={addr}
                cached={cachedSet?.has(addr) ?? false}
                onRemove={onRemove}
                onEdit={onEdit}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
