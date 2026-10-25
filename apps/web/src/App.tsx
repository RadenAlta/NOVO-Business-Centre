import { Bot, Bus, Landmark, LayoutDashboard, UsersRound, LogOut, Menu, ShoppingBasket, Store, Utensils, WalletCards, X } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { api, clearActiveSession, setActiveSession, type Session } from "./api";
import { AccessPage } from "./auth";
import { AssistantPage, CateringPage, DashboardPage, FinancingPage, FundingPage, MasterDataPage, PosPage, PurchasingPage, ShuttlePage } from "./pages";

const navigation = [
  ["/", "Ringkasan", LayoutDashboard],
  ["/master-data", "Master Data", UsersRound],
  ["/pos", "SO Store", Store],
  ["/shuttle", "Shuttle", Bus],
  ["/catering", "Catering", Utensils],
  ["/funding", "Simpanan", Landmark],
  ["/financing", "Pembiayaan", WalletCards],
  ["/purchasing", "Purchasing", ShoppingBasket],
  ["/assistant", "Asisten", Bot],
] as const;

function Shell({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  return <div className="app-shell min-h-screen">
    <button className="mobile-menu" onClick={() => setOpen(!open)} aria-label="Buka navigasi">{open ? <X /> : <Menu />}</button>
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="brand"><span>N</span><div><strong>NOVO</strong><small>Business Centre</small></div></div>
      <nav>{navigation.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === "/"} onClick={() => setOpen(false)}><Icon size={18} />{label}</NavLink>)}</nav>
      <div className="profile"><div className="avatar">{session.user.name.slice(0, 1).toUpperCase()}</div><div><strong>{session.user.name}</strong><small>{session.user.role.replaceAll("_", " ")}</small></div></div>
      <button className="sign-out" onClick={onSignOut}><LogOut size={17} />Keluar</button>
    </aside>
    <main className="content"><Routes>
      <Route path="/" element={<DashboardPage session={session} />} />
      <Route path="/master-data" element={<MasterDataPage session={session} />} />
      <Route path="/pos" element={<PosPage session={session} />} />
      <Route path="/shuttle" element={<ShuttlePage session={session} />} />
      <Route path="/catering" element={<CateringPage session={session} />} />
      <Route path="/funding" element={<FundingPage session={session} />} />
      <Route path="/financing" element={<FinancingPage session={session} />} />
      <Route path="/purchasing" element={<PurchasingPage session={session} />} />
      <Route path="/assistant" element={<AssistantPage session={session} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes></main>
  </div>;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let current = true;
    void api<Session>("/me").then((next) => {
      if (!current) return;
      setActiveSession(next);
      setSession(next);
    }).catch(() => {
      if (!current) return;
      clearActiveSession();
      setSession(null);
    }).finally(() => { if (current) setReady(true); });
    return () => { current = false; };
  }, []);

  const signIn = (next: Session) => { setActiveSession(next); setSession(next); };
  const signOut = async () => {
    try { await api<void>("/auth/logout", { method: "POST" }); }
    finally { clearActiveSession(); setSession(null); }
  };

  if (!ready) return <main className="content" aria-live="polite">Memeriksa sesi aman…</main>;
  return session ? <Shell session={session} onSignOut={() => { void signOut(); }} /> : <AccessPage onSuccess={signIn} />;
}