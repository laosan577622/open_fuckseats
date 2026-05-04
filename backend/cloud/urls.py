from django.urls import path

from . import views


urlpatterns = [
    path('health', views.health, name='health'),
    path('auth/login', views.auth_login, name='auth_login'),
    path('auth/oauth-callback', views.auth_oauth_callback, name='auth_oauth_callback'),
    path('auth/exchange', views.auth_exchange, name='auth_exchange'),
    path('auth/logout', views.auth_logout, name='auth_logout'),
    path('api/me', views.api_me, name='api_me'),
    path('api/me/refresh-subscription', views.api_refresh_subscription, name='api_refresh_subscription'),
    path('api/sync/status', views.sync_status, name='sync_status'),
    path('api/sync/push', views.sync_push, name='sync_push'),
    path('api/sync/push-batch', views.sync_push_batch, name='sync_push_batch'),
    path('api/sync/pull/<uuid:classroom_uuid>', views.sync_pull, name='sync_pull'),
    path('api/sync/<uuid:classroom_uuid>', views.sync_delete, name='sync_delete'),
    path('api/snapshots/<uuid:classroom_uuid>', views.snapshots_list, name='snapshots_list'),
    path('api/snapshots', views.snapshots_create, name='snapshots_create'),
    path('api/snapshots/<int:snapshot_id>/download', views.snapshots_download, name='snapshots_download'),
    path('api/snapshots/<int:snapshot_id>', views.snapshots_delete, name='snapshots_delete'),
    path('api/subscription/plans', views.subscription_plans, name='subscription_plans'),
    path('api/subscription/redeem', views.subscription_redeem, name='subscription_redeem'),
    path('api/subscription/purchase-url', views.subscription_purchase_url, name='subscription_purchase_url'),
]
