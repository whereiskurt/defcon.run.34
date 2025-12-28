import { auth } from "@/config/auth";
import { redirect } from "next/navigation";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  return (
    <div className="relative flex flex-col h-screen">
      <main className="container mx-auto h-screen flex items-center justify-center">
        <div className="w-full max-w-md">
          {children}
        </div>
      </main>
    </div>
  );
}
