import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, Link } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { createAppQueryClient } from '@/app/query-client';
import { AppShell } from '@/app/shell';
import { LoginPage } from '@/pages/login';
import { DashboardPage } from '@/pages/dashboard';
import { ProposalsPage } from '@/pages/proposals';
import { ProposalDetailPage } from '@/pages/proposal-detail';
import { KnowledgePage } from '@/pages/knowledge';
import './index.css';

const queryClient = createAppQueryClient();
const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');
createRoot(root).render(<StrictMode><QueryClientProvider client={queryClient}><BrowserRouter><Routes><Route path="/login" element={<LoginPage />} /><Route element={<AppShell />}><Route index element={<DashboardPage />} /><Route path="knowledge" element={<KnowledgePage />} /><Route path="proposals" element={<ProposalsPage />} /><Route path="proposals/:id" element={<ProposalDetailPage />} /></Route><Route path="*" element={<main className="p-8"><h1>Page not found</h1><Link to="/">Return to dashboard</Link></main>} /></Routes></BrowserRouter></QueryClientProvider></StrictMode>);
