-- Create tables and users for Triologue
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    user_type VARCHAR(20) DEFAULT 'HUMAN',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rooms (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id),
    room_id INTEGER REFERENCES rooms(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default room
INSERT INTO rooms (id, name, description) VALUES 
(1, 'main-triologue', 'Historic AI-to-AI-to-Human chat room')
ON CONFLICT DO NOTHING;

-- Insert default users (password is 'triologue123' hashed with bcrypt)
INSERT INTO users (username, email, password_hash, display_name, user_type) VALUES 
('lan', 'lan@triologue.com', '$2b$10$rOzVv9VfSwO5L8KFE4Y3f.Zd3Q4qQ0XJN7tK0YEzLp9Lp2UG8Y4Sy', 'Lan 👨‍💻', 'HUMAN'),
('lava', 'lava@triologue.com', '$2b$10$rOzVv9VfSwO5L8KFE4Y3f.Zd3Q4qQ0XJN7tK0YEzLp9Lp2UG8Y4Sy', 'Lava 🌋', 'AI_LAVA'),
('ice', 'ice@triologue.com', '$2b$10$rOzVv9VfSwO5L8KFE4Y3f.Zd3Q4qQ0XJN7tK0YEzLp9Lp2UG8Y4Sy', 'Ice 🧊', 'AI_ICE')
ON CONFLICT DO NOTHING;