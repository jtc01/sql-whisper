"""
Seeds a 'small_business' MySQL database with realistic e-commerce data.
Schema: customers, products, orders, order_items, monthly_summary
Run from backend/ with venv active.
"""
import pymysql
import random
from datetime import datetime, timedelta
from decimal import Decimal

# Connect to the demo MySQL container
conn = pymysql.connect(
    host='localhost',
    port=3326,
    user='root',
    password='demopass',
    autocommit=False,
)

print("Creating small_business database...")
with conn.cursor() as c:
    c.execute("DROP DATABASE IF EXISTS small_business")
    c.execute("CREATE DATABASE small_business")
    c.execute("USE small_business")

    # Customers
    c.execute("""
        CREATE TABLE customers (
            customer_id INT PRIMARY KEY,
            first_name VARCHAR(50),
            last_name VARCHAR(50),
            email VARCHAR(255),
            city VARCHAR(50),
            state VARCHAR(2),
            signup_date DATE,
            customer_segment VARCHAR(20)
        )
    """)

    # Products
    c.execute("""
        CREATE TABLE products (
            product_id INT PRIMARY KEY,
            name VARCHAR(100),
            category VARCHAR(50),
            unit_cost DECIMAL(10, 2),
            unit_price DECIMAL(10, 2),
            in_stock INT
        )
    """)

    # Orders
    c.execute("""
        CREATE TABLE orders (
            order_id INT PRIMARY KEY,
            customer_id INT,
            order_date DATE,
            status VARCHAR(20),
            FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
        )
    """)

    # Order items (the meat — joins everything together)
    c.execute("""
        CREATE TABLE order_items (
            order_item_id INT PRIMARY KEY,
            order_id INT,
            product_id INT,
            quantity INT,
            unit_price DECIMAL(10, 2),
            line_total DECIMAL(10, 2),
            FOREIGN KEY (order_id) REFERENCES orders(order_id),
            FOREIGN KEY (product_id) REFERENCES products(product_id)
        )
    """)

print("Generating customers...")
first_names = ['James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
               'William', 'Elizabeth', 'David', 'Barbara', 'Richard', 'Susan', 'Joseph',
               'Jessica', 'Thomas', 'Sarah', 'Charles', 'Karen', 'Christopher', 'Nancy',
               'Daniel', 'Lisa', 'Matthew', 'Margaret', 'Anthony', 'Betty', 'Mark', 'Sandra']
last_names = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
              'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
              'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
              'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson']
cities_states = [('San Francisco', 'CA'), ('Los Angeles', 'CA'), ('San Diego', 'CA'),
                 ('New York', 'NY'), ('Brooklyn', 'NY'), ('Buffalo', 'NY'),
                 ('Austin', 'TX'), ('Houston', 'TX'), ('Dallas', 'TX'),
                 ('Chicago', 'IL'), ('Springfield', 'IL'),
                 ('Miami', 'FL'), ('Orlando', 'FL'), ('Tampa', 'FL'),
                 ('Seattle', 'WA'), ('Portland', 'OR'), ('Denver', 'CO'),
                 ('Boston', 'MA'), ('Philadelphia', 'PA'), ('Atlanta', 'GA')]
segments = ['VIP', 'Regular', 'New', 'At Risk']
segment_weights = [0.10, 0.55, 0.25, 0.10]

customers = []
for i in range(1, 201):  # 200 customers
    fn = random.choice(first_names)
    ln = random.choice(last_names)
    city, state = random.choice(cities_states)
    segment = random.choices(segments, weights=segment_weights)[0]
    signup = datetime.now().date() - timedelta(days=random.randint(30, 730))
    customers.append((i, fn, ln, f'{fn.lower()}.{ln.lower()}{i}@example.com',
                      city, state, signup, segment))

with conn.cursor() as c:
    c.executemany(
        "INSERT INTO customers VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
        customers
    )

print("Generating products...")
products_data = [
    # (name, category, cost, price)
    ('Wireless Headphones', 'Electronics', 45.00, 129.99),
    ('Smart Watch', 'Electronics', 78.00, 199.99),
    ('Bluetooth Speaker', 'Electronics', 22.00, 59.99),
    ('USB-C Cable 6ft', 'Electronics', 3.50, 14.99),
    ('Laptop Stand', 'Electronics', 18.00, 49.99),
    ('Mechanical Keyboard', 'Electronics', 55.00, 139.99),
    ('Wireless Mouse', 'Electronics', 12.00, 39.99),
    ('4K Webcam', 'Electronics', 65.00, 149.99),

    ('Organic Coffee Beans 1lb', 'Food', 6.00, 18.99),
    ('Artisan Tea Sampler', 'Food', 8.50, 24.99),
    ('Dark Chocolate Box', 'Food', 9.00, 29.99),
    ('Hot Sauce Trio', 'Food', 7.00, 21.99),
    ('Olive Oil Premium', 'Food', 11.00, 32.99),

    ('Yoga Mat', 'Fitness', 14.00, 44.99),
    ('Resistance Bands Set', 'Fitness', 9.00, 29.99),
    ('Foam Roller', 'Fitness', 13.00, 36.99),
    ('Water Bottle 32oz', 'Fitness', 5.50, 22.99),
    ('Adjustable Dumbbells', 'Fitness', 95.00, 249.99),

    ('Notebook Hardcover', 'Office', 4.00, 15.99),
    ('Pen Set 12pk', 'Office', 8.00, 22.99),
    ('Desk Organizer', 'Office', 12.00, 34.99),
    ('Wall Calendar 2026', 'Office', 5.00, 17.99),

    ('Scented Candle 8oz', 'Home', 6.50, 21.99),
    ('Throw Blanket', 'Home', 18.00, 54.99),
    ('Ceramic Mug Set', 'Home', 14.00, 39.99),
    ('Indoor Plant Pot', 'Home', 8.00, 24.99),
]

products = []
for pid, (name, cat, cost, price) in enumerate(products_data, start=1):
    products.append((pid, name, cat, cost, price, random.randint(0, 500)))

with conn.cursor() as c:
    c.executemany(
        "INSERT INTO products VALUES (%s,%s,%s,%s,%s,%s)",
        products
    )

print("Generating orders and order items...")
# Generate orders spread over the last 12 months, weighted toward recent months
orders = []
order_items = []
order_id = 1
order_item_id = 1

# Some customers are way more active than others (Pareto-ish)
# Top 10% of customers (VIP-ish) place 40% of orders
customer_activity = {}
for cust in customers:
    cid = cust[0]
    segment = cust[7]
    if segment == 'VIP':
        customer_activity[cid] = random.randint(8, 25)
    elif segment == 'Regular':
        customer_activity[cid] = random.randint(2, 8)
    elif segment == 'New':
        customer_activity[cid] = random.randint(1, 3)
    else:  # At Risk
        customer_activity[cid] = random.randint(0, 2)

# Product popularity isn't uniform — some are bestsellers
# Weight products so top ~5 are clearly bestsellers
product_weights = [random.uniform(0.5, 5.0) for _ in products]
product_weights[0] = 8.0   # Wireless Headphones — clear bestseller
product_weights[8] = 6.5   # Coffee Beans — common repeat purchase
product_weights[13] = 5.5  # Yoga Mat
product_weights[1] = 4.5   # Smart Watch
product_weights[3] = 7.0   # USB-C Cable — cheap, ordered alongside others

for cust in customers:
    cid = cust[0]
    n_orders = customer_activity[cid]
    for _ in range(n_orders):
        # Weight toward recent months (last 3 months get 50% of orders)
        days_ago = int(random.triangular(0, 365, 30))
        order_date = datetime.now().date() - timedelta(days=days_ago)

        status = random.choices(
            ['completed', 'completed', 'completed', 'completed', 'shipped', 'cancelled'],
            weights=[0.7, 0, 0, 0, 0.20, 0.10]
        )[0]

        orders.append((order_id, cid, order_date, status))

        # 1-4 items per order, weighted toward 1-2
        n_items = random.choices([1, 2, 3, 4], weights=[0.40, 0.35, 0.20, 0.05])[0]
        chosen_products = random.choices(products, weights=product_weights, k=n_items)

        for prod in chosen_products:
            pid = prod[0]
            unit_price = prod[4]
            qty = random.choices([1, 2, 3], weights=[0.75, 0.20, 0.05])[0]
            line_total = round(float(unit_price) * qty, 2)
            order_items.append((order_item_id, order_id, pid, qty, unit_price, line_total))
            order_item_id += 1

        order_id += 1

with conn.cursor() as c:
    c.executemany(
        "INSERT INTO orders VALUES (%s,%s,%s,%s)",
        orders
    )
    c.executemany(
        "INSERT INTO order_items VALUES (%s,%s,%s,%s,%s,%s)",
        order_items
    )

conn.commit()
conn.close()

print(f"\nDone. Seeded:")
print(f"  - {len(customers)} customers")
print(f"  - {len(products)} products")
print(f"  - {len(orders)} orders")
print(f"  - {len(order_items)} order items")
print(f"\nDatabase: small_business on localhost:3326")
print(f"\nRegister it as a connection via POST /connections with:")
print(f'  host: localhost, port: 3326, db_name: small_business, username: root, password: demopass')
