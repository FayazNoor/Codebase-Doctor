import React, { useState } from 'react';
import ReactDOM from 'react-dom';

// React 17: explicit unstable_batchedUpdates — manual migration per react-bc-7
function handleClick() {
  ReactDOM.unstable_batchedUpdates(() => {
    // multiple setState calls that were previously unbatched
  });
}

export default function BatchedUpdatesExample() {
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);

  return (
    <div>
      <p>{a} {b}</p>
      <button onClick={handleClick}>Update</button>
    </div>
  );
}
