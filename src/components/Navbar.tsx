import { useState } from 'react';
import Link from 'next/link';

const Navbar: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <nav className="bg-neutral-800 p-4">
      <div className="container mx-auto flex items-center justify-between">
        <Link href="/" className="text-xl font-bold text-white">
          HeyVera
        </Link>
        <button
          className="md:hidden focus:outline-none"
          onClick={() => setIsOpen(!isOpen)}
        >
          <svg
            className="h-6 w-6 fill-current text-white"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            {isOpen ? (
              <path d="M18.414 7.586a1 1 0 0 0-1.414 0L12 10.586l-4.586-3.002a1 1 0 1 0-1.414 1.414l5 5a1 1 0 0 0 1.414 0l5-5a1 1 0 0 0 0-1.414z" />
            ) : (
              <path d="M3 6h18v2H3V6zm0 7h18v2H3v-2zm0 7h18v2H3v-2z" />
            )}
          </svg>
        </button>
        <div
          className={`md:flex md:items-center ${
            isOpen ? 'block' : 'hidden'
          } md:block`}
        >
          <Link href="/about" className="mx-4 text-white hover:text-emerald-400">
            About
          </Link>
          <Link href="/services" className="mx-4 text-white hover:text-emerald-400">
            Services
          </Link>
          <Link href="/contact" className="mx-4 text-white hover:text-emerald-400">
            Contact
          </Link>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
