#!/bin/bash

# Check if host is provided as a command line argument
if [ -z "$1" ]; then
  echo "Usage: $0 <host>"
  echo "Example: $0 http://localhost:3000"
  exit 1
fi
host=$1

# Trap SIGINT (Ctrl+C) to execute the cleanup function
cleanup() {
  echo "Terminating background processes..."
  kill $pid1 $pid2 $pid3 $pid4 $pid5 $pid6 $pid7 $pid8 $pid9
  exit 0
}
trap cleanup SIGINT

# Returns a random integer between min and max (inclusive)
rand_between() {
  local min=$1
  local max=$2
  echo $(( RANDOM % (max - min + 1) + min ))
}

# Wrap curl command to return HTTP response codes
execute_curl() {
  echo $(eval "curl -s -o /dev/null -w \"%{http_code}\" $1")
}

# Function to login and get a token
login() {
  response=$(curl -s -X PUT $host/api/auth -d "{\"email\":\"$1\", \"password\":\"$2\"}" -H 'Content-Type: application/json')
  token=$(echo $response | jq -r '.token')
  echo $token
}

# Simulate a user requesting the menu (every 2-5 seconds)
while true; do
  result=$(execute_curl $host/api/order/menu)
  echo "Requesting menu..." $result
  sleep $(rand_between 2 5)
done &
pid1=$!

# Simulate a user with an invalid email and password (every 15-35 seconds)
while true; do
  result=$(execute_curl "-X PUT \"$host/api/auth\" -d '{\"email\":\"unknown@jwt.com\", \"password\":\"bad\"}' -H 'Content-Type: application/json'")
  echo "Logging in with invalid credentials..." $result
  sleep $(rand_between 15 35)
done &
pid2=$!

# Simulate a franchisee logging in (every 90-130 seconds)
while true; do
  token=$(login "f@jwt.com" "franchisee")
  echo "Login franchisee..." $( [ -z "$token" ] && echo "false" || echo "true" )
  sleep $(rand_between 90 130)
  result=$(execute_curl "-X DELETE $host/api/auth -H \"Authorization: Bearer $token\"")
  echo "Logging out franchisee..." $result
  sleep $(rand_between 5 15)
done &
pid3=$!

# Simulate diner1 ordering a pizza (every 40-70 seconds)
while true; do
  token=$(login "d@jwt.com" "diner")
  echo "Login diner..." $( [ -z "$token" ] && echo "false" || echo "true" )
  result=$(execute_curl "-X POST $host/api/order -H 'Content-Type: application/json' -d '{\"franchiseId\": 1, \"storeId\":1, \"items\":[{ \"menuId\": 1, \"description\": \"Veggie\", \"price\": 0.05 }]}'  -H \"Authorization: Bearer $token\"")
  echo "Bought a pizza (diner1)..." $result
  sleep $(rand_between 15 25)
  result=$(execute_curl "-X DELETE $host/api/auth -H \"Authorization: Bearer $token\"")
  echo "Logging out diner1..." $result
  sleep $(rand_between 25 45)
done &
pid4=$!

# Simulate a failed pizza order (every 4-7 minutes)
while true; do
  token=$(login "d@jwt.com" "diner")
  echo "Login hungry diner..." $( [ -z "$token" ] && echo "false" || echo "true" )

  items='{ "menuId": 1, "description": "Veggie", "price": 0.05 }'
  for (( i=0; i < 21; i++ ))
  do items+=', { "menuId": 1, "description": "Veggie", "price": 0.05 }'
  done

  result=$(execute_curl "-X POST $host/api/order -H 'Content-Type: application/json' -d '{\"franchiseId\": 1, \"storeId\":1, \"items\":[$items]}'  -H \"Authorization: Bearer $token\"")
  echo "Bought too many pizzas..." $result
  sleep $(rand_between 3 8)
  result=$(execute_curl "-X DELETE $host/api/auth -H \"Authorization: Bearer $token\"")
  echo "Logging out hungry diner..." $result
  sleep $(rand_between 240 420)
done &
pid5=$!

# Simulate a second franchisee logging in and checking orders (every 3-6 minutes)
while true; do
  token=$(login "f2@jwt.com" "franchisee2")
  echo "Login franchisee2..." $( [ -z "$token" ] && echo "false" || echo "true" )
  sleep $(rand_between 180 360)
  result=$(execute_curl "-X DELETE $host/api/auth -H \"Authorization: Bearer $token\"")
  echo "Logging out franchisee2..." $result
  sleep $(rand_between 10 30)
done &
pid6=$!

# Simulate diner2 ordering multiple different pizzas (every 60-120 seconds)
while true; do
  token=$(login "d2@jwt.com" "diner2")
  echo "Login diner2..." $( [ -z "$token" ] && echo "false" || echo "true" )
  num_pizzas=$(rand_between 1 3)
  items='{ "menuId": 1, "description": "Veggie", "price": 0.05 }'
  for (( i=1; i < num_pizzas; i++ ))
  do items+=', { "menuId": 2, "description": "Pepperoni", "price": 0.06 }'
  done
  result=$(execute_curl "-X POST $host/api/order -H 'Content-Type: application/json' -d '{\"franchiseId\": 1, \"storeId\":1, \"items\":[$items]}'  -H \"Authorization: Bearer $token\"")
  echo "Diner2 bought $num_pizzas pizza(s)..." $result
  sleep $(rand_between 20 40)
  result=$(execute_curl "-X DELETE $host/api/auth -H \"Authorization: Bearer $token\"")
  echo "Logging out diner2..." $result
  sleep $(rand_between 40 80)
done &
pid7=$!

# Simulate an admin user doing periodic check-ins (every 5-10 minutes)
while true; do
  token=$(login "a@jwt.com" "admin")
  echo "Login admin..." $( [ -z "$token" ] && echo "false" || echo "true" )
  sleep $(rand_between 300 600)
  result=$(execute_curl "-X DELETE $host/api/auth -H \"Authorization: Bearer $token\"")
  echo "Logging out admin..." $result
  sleep $(rand_between 30 90)
done &
pid8=$!

# Simulate a guest browsing the menu repeatedly then failing login (every 45-90 seconds)
while true; do
  browse_count=$(rand_between 2 5)
  for (( i=0; i < browse_count; i++ ))
  do
    result=$(execute_curl $host/api/order/menu)
    echo "Guest browsing menu..." $result
    sleep $(rand_between 1 4)
  done
  result=$(execute_curl "-X PUT \"$host/api/auth\" -d '{\"email\":\"guest@jwt.com\", \"password\":\"wrongpass\"}' -H 'Content-Type: application/json'")
  echo "Guest failed login attempt..." $result
  sleep $(rand_between 30 60)
done &
pid9=$!


# Wait for the background processes to complete
wait $pid1 $pid2 $pid3 $pid4 $pid5 $pid6 $pid7 $pid8 $pid9