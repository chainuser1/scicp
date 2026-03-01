import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Presenter from './pages/Presenter';
import Client from './pages/Client';
import './App.css';

function Home() {
  return (
    <div>
      <h1>Scripture Projector</h1>
      <nav>
        <ul>
          <li>
            <Link to="/presenter">Presenter</Link>
          </li>
          <li>
            <Link to="/client">Client</Link>
          </li>
        </ul>
      </nav>
    </div>
  );
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/presenter" element={<Presenter />} />
        <Route path="/client" element={<Client />} />
      </Routes>
    </Router>
  );
}

export default App;
