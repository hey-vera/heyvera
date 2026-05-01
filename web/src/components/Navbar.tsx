// entire file content ...
import React from 'react';

function Navbar() {
  return (
    <nav className="bg-gray-800 p-4">
      <div className="container mx-auto flex justify-between items-center text-white">
        <a href="/" className="text-lg font-bold">HeyVera</a>
        <ul className="flex space-x-4">
          <li><a href="#why">Why</a></li>
          <li><a href="#surface">Surface</a></li>
          <li><a href="#how-it-works">How It Works</a></li>
          <li><a href="#founding">Founding</a></li>
        </ul>
      </div>
    </nav>
  );
}

export default Navbar;
