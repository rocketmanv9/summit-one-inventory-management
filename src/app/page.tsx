import { LayoutDashboard, TrendingUp, Package, AlertTriangle } from 'lucide-react';

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Overview of your inventory management system
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">
                Total Items
              </p>
              <p className="text-2xl font-bold">24</p>
              <p className="text-xs text-muted-foreground">
                +2 from last month
              </p>
            </div>
            <Package className="h-8 w-8 text-primary" />
          </div>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">
                Total Locations
              </p>
              <p className="text-2xl font-bold">8</p>
              <p className="text-xs text-muted-foreground">
                2 yards, 3 trucks, 3 jobs
              </p>
            </div>
            <LayoutDashboard className="h-8 w-8 text-accent" />
          </div>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">
                Low Stock Alerts
              </p>
              <p className="text-2xl font-bold text-destructive">3</p>
              <p className="text-xs text-muted-foreground">
                Requires attention
              </p>
            </div>
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">
                Today's Activity
              </p>
              <p className="text-2xl font-bold">12</p>
              <p className="text-xs text-success">
                ↑ 8.2% from yesterday
              </p>
            </div>
            <TrendingUp className="h-8 w-8 text-success" />
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Quick Actions</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <button className="rounded-lg border border-primary bg-primary/5 p-4 text-left hover:bg-primary/10">
            <p className="font-medium text-primary">Receive Stock</p>
            <p className="text-sm text-muted-foreground">
              Log incoming inventory
            </p>
          </button>
          <button className="rounded-lg border p-4 text-left hover:bg-muted">
            <p className="font-medium">Transfer Stock</p>
            <p className="text-sm text-muted-foreground">
              Move between locations
            </p>
          </button>
          <button className="rounded-lg border p-4 text-left hover:bg-muted">
            <p className="font-medium">Issue Stock</p>
            <p className="text-sm text-muted-foreground">
              Allocate to jobs
            </p>
          </button>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Recent Activity</h2>
        <div className="space-y-3">
          {[
            { action: 'Receipt', item: 'Premium Sealcoat', qty: '+500 gal', time: '2 hours ago' },
            { action: 'Transfer', item: 'Hot Mix Asphalt', qty: '2 tons', time: '5 hours ago' },
            { action: 'Issue', item: 'Cold Patch Mix', qty: '-150 lbs', time: '1 day ago' },
          ].map((activity, i) => (
            <div
              key={i}
              className="flex items-center justify-between border-b pb-3 last:border-0"
            >
              <div>
                <p className="font-medium">{activity.action}: {activity.item}</p>
                <p className="text-sm text-muted-foreground">{activity.time}</p>
              </div>
              <span className="text-sm font-medium">{activity.qty}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
