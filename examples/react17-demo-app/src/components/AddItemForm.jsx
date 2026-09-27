import React, { useState } from 'react';

export default function AddItemForm({ onAdd }) {
  const [name, setName] = useState('');

  const submit = (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setName('');
  };

  return (
    <form onSubmit={submit} aria-label="Add item">
      <label htmlFor="item-name">Item</label>
      <input id="item-name" value={name} onChange={(e) => setName(e.target.value)} />
      <button type="submit">Add</button>
    </form>
  );
}
