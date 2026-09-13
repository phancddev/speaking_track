"use client"

import { LibraryIcon, ListVideoIcon, LogOutIcon, UsersIcon, VideoIcon } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { type ComponentType, useEffect, useState } from "react"
import { authClient } from "@/lib/auth/client"
import { ThemeToggle } from "@/components/theme-toggle"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"

type NavItem = {
  href: string
  label: string
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>
  adminOnly?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { href: "/library", label: "Library", icon: LibraryIcon },
  { href: "/settings/youtube", label: "YouTube", icon: VideoIcon },
  { href: "/admin/users", label: "Users", icon: UsersIcon, adminOnly: true },
  { href: "/admin/youtube", label: "Connections", icon: UsersIcon, adminOnly: true },
  { href: "/admin/queue", label: "Queue", icon: ListVideoIcon, adminOnly: true },
]

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("")
}

function NavLinks({ isAdmin, onNavigate }: { isAdmin: boolean; onNavigate?: () => void }) {
  const pathname = usePathname()
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Navigation</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin).map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  isActive={active}
                  tooltip={item.label}
                  render={<Link href={item.href} onClick={onNavigate} />}
                >
                  <item.icon aria-hidden />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

export function AppShell({
  user,
  children,
}: {
  user: { name: string; email: string; role: "admin" | "user" }
  children: React.ReactNode
}) {
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    if (!signingOut) return
    let cancelled = false
    void authClient.signOut().then(() => {
      if (!cancelled) router.push("/login")
    })
    return () => {
      cancelled = true
    }
  }, [signingOut, router])

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <span className="text-sm font-semibold tracking-tight">Speaking Track</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <NavLinks isAdmin={user.role === "admin"} />
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger aria-label="Toggle navigation sidebar" />
          <Separator orientation="vertical" className="h-4" />
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Account menu"
                    className="rounded-full"
                  />
                }
              >
                <Avatar className="size-8">
                  <AvatarFallback className="text-xs">{initials(user.name)}</AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    <div className="text-sm font-medium">{user.name}</div>
                    <div className="text-muted-foreground truncate text-xs">{user.email}</div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={signingOut} onClick={() => setSigningOut(true)}>
                  <LogOutIcon aria-hidden />
                  {signingOut ? "Signing out…" : "Sign out"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex-1 overflow-auto">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
