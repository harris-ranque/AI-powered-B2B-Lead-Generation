import { useQuery, useMutation } from "convex/react";
import { api } from "@genni/convex-types";
import type { Id } from "@genni/convex-types/dataModel";

export function useNotifications() {
  const notifications = useQuery(
    api.notifications.queries.getUserNotifications,
  );
  const unreadCount = useQuery(api.notifications.queries.getNotificationCounts);

  const markAsRead = useMutation(api.notifications.mutations.markAsRead);
  const markAllAsRead = useMutation(api.notifications.mutations.markAllAsRead);
  const deleteNotification = useMutation(
    api.notifications.mutations.deleteNotification,
  );

  return {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    isLoading: notifications === undefined,
  };
}
