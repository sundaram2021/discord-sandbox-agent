import pygame
import random
import math

# Initialize Pygame
pygame.init()

# Screen dimensions
SCREEN_WIDTH = 800
SCREEN_HEIGHT = 600

# Create the screen
screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
pygame.display.set_caption("Space Invaders")

# Clock for FPS
clock = pygame.time.Clock()
FPS = 60

# Colors
BLACK = (0, 0, 0)
WHITE = (255, 255, 255)
GREEN = (0, 255, 0)
RED = (255, 0, 0)

# Player class
class Player(pygame.sprite.Sprite):
    def __init__(self):
        super().__init__()
        self.image = pygame.Surface((50, 50))
        self.image.fill(GREEN)
        self.rect = self.image.get_rect()
        self.rect.centerx = SCREEN_WIDTH // 2
        self.rect.bottom = SCREEN_HEIGHT - 10
        self.speed = 5

    def update(self):
        keys = pygame.key.get_pressed()
        if keys[pygame.K_LEFT] and self.rect.left > 0:
            self.rect.x -= self.speed
        if keys[pygame.K_RIGHT] and self.rect.right < SCREEN_WIDTH:
            self.rect.x += self.speed

    def shoot(self):
        bullet = Bullet(self.rect.centerx, self.rect.top)
        all_sprites.add(bullet)
        bullets.add(bullet)

# Enemy class
class Enemy(pygame.sprite.Sprite):
    def __init__(self, x, y):
        super().__init__()
        self.image = pygame.Surface((40, 40))
        self.image.fill(RED)
        self.rect = self.image.get_rect()
        self.rect.x = x
        self.rect.y = y
        self.speed = 2
        self.direction = 1

    def update(self):
        self.rect.x += self.speed * self.direction
        self.rect.y += 1

        if self.rect.right >= SCREEN_WIDTH or self.rect.left <= 0:
            self.direction *= -1
            self.rect.y += 20

        if self.rect.top > SCREEN_HEIGHT:
            self.kill()

# Bullet class
class Bullet(pygame.sprite.Sprite):
    def __init__(self, x, y):
        super().__init__()
        self.image = pygame.Surface((5, 15))
        self.image.fill(WHITE)
        self.rect = self.image.get_rect()
        self.rect.centerx = x
        self.rect.bottom = y
        self.speed = -7

    def update(self):
        self.rect.y += self.speed
        if self.rect.bottom < 0:
            self.kill()

# Sprite groups
all_sprites = pygame.sprite.Group()
enemies = pygame.sprite.Group()
bullets = pygame.sprite.Group()

# Create player
player = Player()
all_sprites.add(player)

# Create initial enemies
for i in range(5):
    enemy = Enemy(random.randint(0, SCREEN_WIDTH - 40), random.randint(20, 100))
    all_sprites.add(enemy)
    enemies.add(enemy)

# Game variables
score = 0
wave = 1
font = pygame.font.Font(None, 36)
game_over = False

# Game loop
running = True
while running:
    clock.tick(FPS)

    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            running = False
        if event.type == pygame.KEYDOWN:
            if event.key == pygame.K_SPACE and not game_over:
                player.shoot()
            if event.key == pygame.K_SPACE and game_over:
                # Reset game
                all_sprites.empty()
                enemies.empty()
                bullets.empty()
                
                player = Player()
                all_sprites.add(player)
                
                for i in range(5 + wave):
                    enemy = Enemy(random.randint(0, SCREEN_WIDTH - 40), random.randint(20, 100))
                    all_sprites.add(enemy)
                    enemies.add(enemy)
                
                score = 0
                game_over = False

    if not game_over:
        all_sprites.update()

        # Collision detection: bullets and enemies
        hits = pygame.sprite.groupcollide(enemies, bullets, True, True)
        for hit in hits:
            score += 10
            enemy = Enemy(random.randint(0, SCREEN_WIDTH - 40), random.randint(20, 100))
            all_sprites.add(enemy)
            enemies.add(enemy)

        # Collision detection: enemies and player
        hits = pygame.sprite.spritecollide(player, enemies, False)
        if hits:
            game_over = True

        # Check if all enemies defeated
        if len(enemies) == 0:
            wave += 1
            for i in range(5 + wave):
                enemy = Enemy(random.randint(0, SCREEN_WIDTH - 40), random.randint(20, 100))
                all_sprites.add(enemy)
                enemies.add(enemy)

    # Draw everything
    screen.fill(BLACK)
    all_sprites.draw(screen)

    # Display score
    score_text = font.render(f"Score: {score}", True, WHITE)
    screen.blit(score_text, (10, 10))

    # Display wave
    wave_text = font.render(f"Wave: {wave}", True, WHITE)
    screen.blit(wave_text, (SCREEN_WIDTH - 200, 10))

    # Display game over message
    if game_over:
        game_over_text = font.render("GAME OVER! Press SPACE to Restart", True, RED)
        text_rect = game_over_text.get_rect(center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2))
        screen.blit(game_over_text, text_rect)

    pygame.display.flip()

pygame.quit()
