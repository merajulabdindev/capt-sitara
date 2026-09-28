import './globals.css';
export const metadata = { title: 'Capt Sitara' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}<footer>Made with love by your hubby</footer></body></html>);
}
