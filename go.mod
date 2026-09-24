// Module for the Vercel Go function in api/. The API itself is the backend
// module, wired in by the replace directive below.
module finance-vercel

go 1.27.0

require finance-backend v0.0.0

require (
	github.com/go-chi/chi/v5 v5.3.2 // indirect
	github.com/go-chi/cors v1.2.2 // indirect
	github.com/golang-jwt/jwt/v5 v5.3.1 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/lib/pq v1.12.3 // indirect
	golang.org/x/crypto v0.57.0 // indirect
)

replace finance-backend => ./backend
