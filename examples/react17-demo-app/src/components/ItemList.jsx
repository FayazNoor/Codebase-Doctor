import React from 'react';

export default class ItemList extends React.Component {
  render() {
    const { items, onToggle } = this.props;
    if (items.length === 0) return <p>Nothing on the list yet.</p>;
    return (
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <label>
              <input type="checkbox" checked={item.done} onChange={() => onToggle(item.id)} />
              {item.name}
            </label>
          </li>
        ))}
      </ul>
    );
  }
}
