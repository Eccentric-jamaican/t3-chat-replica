import { createFileRoute } from '@tanstack/react-router'
import { Sidebar } from '../components/layout/Sidebar'
import { useEffect, useState } from 'react'
import { useIsMobile } from '../hooks/useIsMobile'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Label } from '../components/ui/label'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { motion } from 'framer-motion'
import { User, Shield, Link2, Gift, Mail } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  const isMobile = useIsMobile()
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile)

  useEffect(() => {
    setSidebarOpen(!isMobile)
  }, [isMobile])

  return (
    <div className="flex h-dvh min-h-screen overflow-hidden bg-background relative">
      <div className="edge-glow-top" />
      <div className="edge-glow-bottom" />
      <div className="bg-noise" />

      <Sidebar isOpen={sidebarOpen} onToggle={setSidebarOpen} />

      <div className="flex-1 flex flex-col relative min-w-0 overflow-y-auto scrollbar-hide">
        <div className="max-w-4xl mx-auto w-full px-6 py-12 md:py-20 mt-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <h1 className="text-3xl font-black text-foreground mb-2 flex items-center gap-2">
              Settings
            </h1>
            <p className="text-foreground/50 mb-8 font-medium">
              Manage your account settings and preferences.
            </p>

            <Tabs defaultValue="profile" className="w-full">
              <TabsList className="mb-8 flex flex-nowrap h-auto gap-2 bg-transparent p-0 justify-start overflow-x-auto scrollbar-hide pb-2">
                <TabsTrigger value="profile" className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-white shrink-0">
                  <User size={16} />
                  <span>Profile</span>
                </TabsTrigger>
                <TabsTrigger value="security" className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-white shrink-0">
                  <Shield size={16} />
                  <span>Security</span>
                </TabsTrigger>
                <TabsTrigger value="connections" className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-white shrink-0">
                  <Link2 size={16} />
                  <span>Connections</span>
                </TabsTrigger>
                <TabsTrigger value="rewards" className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-white shrink-0">
                  <Gift size={16} />
                  <span>Rewards</span>
                </TabsTrigger>
                <TabsTrigger value="contact" className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-white shrink-0">
                  <Mail size={16} />
                  <span>Contact Us</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="profile">
                <Card>
                  <CardHeader>
                    <CardTitle>Profile Information</CardTitle>
                    <CardDescription>Update your personal details and how others see you.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="flex flex-col md:flex-row gap-6 items-start">
                       <div className="w-24 h-24 rounded-full bg-primary/10 border-2 border-dashed border-primary/30 flex items-center justify-center shrink-0">
                          <User size={40} className="text-primary/40" />
                       </div>
                       <div className="flex-1 w-full space-y-4">
                          <div className="grid gap-2">
                            <Label htmlFor="name">Display Name</Label>
                            <Input id="name" placeholder="Tellahneishe Callum" />
                          </div>
                          <div className="grid gap-2">
                            <Label htmlFor="email">Email Address</Label>
                            <Input id="email" type="email" placeholder="user@example.com" />
                          </div>
                          <div className="grid gap-2">
                            <Label htmlFor="bio">Bio</Label>
                            <textarea 
                              id="bio"
                              className="flex min-h-[100px] w-full rounded-xl border border-black/5 bg-black/[0.03] px-3 py-2 text-sm text-foreground shadow-sm transition-colors placeholder:text-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                              placeholder="Tell us a bit about yourself..."
                            />
                          </div>
                       </div>
                    </div>
                    <div className="flex justify-end">
                      <Button>Save Changes</Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="security">
                <Card>
                  <CardHeader>
                    <CardTitle>Security</CardTitle>
                    <CardDescription>Manage your account password and security preferences.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid gap-4">
                      <div className="grid gap-2">
                        <Label htmlFor="current-password">Current Password</Label>
                        <Input id="current-password" type="password" />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="new-password">New Password</Label>
                        <Input id="new-password" type="password" />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="confirm-password">Confirm New Password</Label>
                        <Input id="confirm-password" type="password" />
                      </div>
                    </div>
                    <div className="pt-4 border-t border-black/5">
                      <h4 className="font-bold text-sm mb-4">Two-Factor Authentication</h4>
                      <div className="flex items-center justify-between p-4 rounded-xl bg-black/[0.02] border border-black/5">
                        <div>
                          <p className="font-bold text-sm">Authenticator App</p>
                          <p className="text-xs text-foreground/50">Protect your account with a mobile authenticator app.</p>
                        </div>
                        <Button variant="secondary" size="sm">Setup</Button>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button>Update Security</Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="connections">
                <Card>
                  <CardHeader>
                    <CardTitle>Connections</CardTitle>
                    <CardDescription>Manage your connected third-party accounts.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {[
                      { name: 'Google', icon: 'G', status: 'Connected', email: 'user@gmail.com' },
                      { name: 'GitHub', icon: 'GH', status: 'Not Connected' },
                      { name: 'Discord', icon: 'D', status: 'Not Connected' },
                    ].map((conn) => (
                      <div key={conn.name} className="flex items-center justify-between p-4 rounded-xl bg-black/[0.02] border border-black/5">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center font-bold text-xs border border-black/5">
                            {conn.icon}
                          </div>
                          <div>
                            <p className="font-bold text-sm">{conn.name}</p>
                            <p className="text-xs text-foreground/50">{conn.email || conn.status}</p>
                          </div>
                        </div>
                        <Button variant={conn.status === 'Connected' ? 'outline' : 'secondary'} size="sm">
                          {conn.status === 'Connected' ? 'Disconnect' : 'Connect'}
                        </Button>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="rewards">
                <Card>
                  <CardHeader>
                    <CardTitle>Rewards & Credits</CardTitle>
                    <CardDescription>View your current balance and earning history.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-6 rounded-2xl bg-primary/5 border border-primary/10 flex flex-col items-center text-center">
                        <span className="text-xs font-bold text-primary/60 uppercase tracking-widest mb-1">Total Credits</span>
                        <span className="text-4xl font-black text-primary">250</span>
                      </div>
                      <div className="p-6 rounded-2xl bg-t3-berry/5 border border-t3-berry/10 flex flex-col items-center text-center">
                        <span className="text-xs font-bold text-t3-berry/60 uppercase tracking-widest mb-1">Messages Left</span>
                        <span className="text-4xl font-black text-t3-berry">9</span>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h4 className="font-bold text-sm">Recent Activity</h4>
                      {[
                        { title: 'Daily Login Reward', date: 'Jan 26, 2026', amount: '+10', type: 'positive' },
                        { title: 'Referral Bonus', date: 'Jan 24, 2026', amount: '+50', type: 'positive' },
                        { title: 'Message Quota Refill', date: 'Jan 20, 2026', amount: '+100', type: 'positive' },
                      ].map((activity, i) => (
                        <div key={i} className="flex items-center justify-between py-2 border-b border-black/5 last:border-0">
                          <div>
                            <p className="font-bold text-sm">{activity.title}</p>
                            <p className="text-xs text-foreground/50">{activity.date}</p>
                          </div>
                          <span className={cn("font-black", activity.type === 'positive' ? 'text-green-600' : 'text-red-500')}>
                            {activity.amount}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="contact">
                <Card>
                  <CardHeader>
                    <CardTitle>Contact Us</CardTitle>
                    <CardDescription>Have a question or feedback? We'd love to hear from you.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4">
                      <div className="grid gap-2">
                        <Label htmlFor="subject">Subject</Label>
                        <Input id="subject" placeholder="What is this regarding?" />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="message">Message</Label>
                        <textarea 
                          id="message"
                          className="flex min-h-[150px] w-full rounded-xl border border-black/5 bg-black/[0.03] px-3 py-2 text-sm text-foreground shadow-sm transition-colors placeholder:text-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                          placeholder="Write your message here..."
                        />
                      </div>
                    </div>
                    <div className="flex justify-end pt-2">
                      <Button className="w-full md:w-auto h-12 md:px-12">Send Message</Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
