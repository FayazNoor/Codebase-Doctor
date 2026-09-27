import React, { useReducer } from 'react';
import AddItemForm from './components/AddItemForm';
import ItemList from './components/ItemList';
import SyncStatus from './components/SyncStatus';
import { showToast } from './legacy/toast';

function itemsReducer(items, action) {
  switch (action.type) {
    case 'add':
      return [...items, { id: items.length + 1, name: action.name, done: false }];
    case 'toggle':
      return items.map((item) => (item.id === action.id ? { ...item, done: !item.done } : item));
    default:
      return items;
  }
}

function saveToServer() {
  return new Promise((resolve) => setTimeout(() => resolve(new Date().toLocaleTimeString()), 300));
}

export default function App() {
  const [items, dispatch] = useReducer(itemsReducer, []);

  const addItem = (name) => {
    dispatch({ type: 'add', name });
    showToast(`Added ${name}`);
  };

  return (
    <main>
      <h1>Pantry list</h1>
      <AddItemForm onAdd={addItem} />
      <ItemList items={items} onToggle={(id) => dispatch({ type: 'toggle', id })} />
      <SyncStatus sync={saveToServer} />
    </main>
  );
}
