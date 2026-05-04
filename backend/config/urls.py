from django.urls import include, path


urlpatterns = [
    path('', include('cloud.urls')),
]
