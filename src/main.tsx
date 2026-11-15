import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { Home } from './pages/Home.tsx';
import { Host } from './pages/Host.tsx';
import { Guest } from './pages/Guest.tsx';
import { Stage } from './pages/Stage.tsx';
import { ResetPassword } from './pages/ResetPassword.tsx';
import { HelpPage } from './components/Help.tsx';
import './styles.css';
import './themes.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/host/:code" element={<Host />} />
        <Route path="/p/:code" element={<Guest />} />
        <Route path="/stage/:code" element={<Stage />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
