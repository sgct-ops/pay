import { AppShell, RoleHome } from "@/components/AppShell";

/**
 * The root sends people to the screen their role starts at — operations to the
 * verify ledger, accounts to the refunds queue. It renders inside the shell so
 * signing in happens here too, rather than bouncing through a redirect first.
 */
export default function Home() {
  return (
    <AppShell>
      <RoleHome />
    </AppShell>
  );
}
