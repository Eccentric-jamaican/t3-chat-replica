import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/explore/category/$categoryId')({
  component: () => <Outlet />,
})
