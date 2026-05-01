import React from 'react';
import Navbar from './components/Navbar';

const App: React.FC = () => {
  return (
    <div>
      <Navbar />
      {/* Existing single-page HeyVera scaffold content */}
      <h1>Welcome to HeyVera</h1>
      <p>This is the main page of the HeyVera application.</p>
    </div>
  );
};

export default App;
