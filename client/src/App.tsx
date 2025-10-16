import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Chat from './pages/Chat';
import './style.css';

function PrivateRoute({ children }: { children: React.ReactElement }) {
  const { user, initializing } = useAuth();
  if (initializing) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-slate-500">
        <div className="flex items-center gap-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-sky-600 border-t-transparent"></div>
          <span>Loading...</span>
        </div>
      </div>
    );
  }
  return user ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<PrivateRoute><Chat /></PrivateRoute>} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
