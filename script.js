class NewsStream {
    constructor() {
        this.container = document.querySelector('.news-container');
        this.queue = [];
        this.isAnimating = false;
        this.displayDuration = 5000; // How long each item stays visible
        this.sharedLinks = new Map(); // Track shared link counts
        this.topSharedContainer = document.querySelector('.shared-links');
        
        this.marqueeTrack = document.querySelector('.marquee-track');
        this.marqueeItems = [];
        this.marqueeSpeed = 1; // pixels per frame
        this.maxMarqueeItems = 20; // Maximum number of items to keep in marquee
        
        this.startTime = new Date();
        this.timeIndicator = document.querySelector('.time-indicator');
        this.timeIndicator.innerHTML = '(gathering first stories... please wait)<span class="loading-spinner"></span>';
        
        this.initWebSocket();
        this.processQueue();
        
        // Update top shared links every minute
        setInterval(() => this.updateTopSharedLinks(), 60000);
        
        this.animateMarquee();
        
        // Add a one-time timeout to start showing minutes after 60 seconds
        setTimeout(() => {
            this.updateTimeIndicator();
            setInterval(() => this.updateTimeIndicator(), 60000); // Update every minute
        }, 60000);
    }

    initWebSocket() {
        const url = "wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post";
        const ws = new WebSocket(url);

        ws.onmessage = (event) => {
            const json = JSON.parse(event.data);
            const record = json.commit?.record;
            
            if (record && record.embed?.$type === "app.bsky.embed.external") {
                const external = record.embed.external;
                const thumbLink = external.thumb?.ref?.$link;
                
                const content = {
                    title: external.title || 'No Title',
                    url: external.uri || '#',
                    description: external.description || '',
                    timestamp: new Date(),
                    thumb: thumbLink ? this.getThumbUrl(thumbLink, json.did) : null
                };
                
                // Add to marquee if there's a thumbnail and we're under the limit
                if (content.thumb && this.marqueeTrack.children.length < this.maxMarqueeItems) {
                    const marqueeItem = this.createMarqueeItem(content);
                    this.marqueeTrack.appendChild(marqueeItem);
                }
                
                // Track shared links with unique users
                if (content.url !== '#') {
                    if (!this.sharedLinks.has(content.url)) {
                        this.sharedLinks.set(content.url, {
                            title: content.title,
                            description: content.description,
                            thumbLink: thumbLink,
                            did: json.did,
                            count: 1,
                            firstSeen: content.timestamp,
                            uniqueUsers: new Set([json.did]) // Track unique users
                        });
                    } else {
                        const data = this.sharedLinks.get(content.url);
                        // Only increment count if this user hasn't shared before
                        if (!data.uniqueUsers.has(json.did)) {
                            data.count++;
                            data.uniqueUsers.add(json.did);
                            this.sharedLinks.set(content.url, data);
                        }
                    }
                    this.updateTopSharedLinks();
                }
                
                this.queue.push(content);
            }
        };

        ws.onopen = () => console.log("Connected to Bluesky WebSocket");
        ws.onerror = (error) => console.error("WebSocket error:", error);
        ws.onclose = () => console.log("WebSocket connection closed");
    }

    createNewsItem(content) {
        const item = document.createElement('div');
        item.className = 'news-item';
        
        const time = document.createElement('div');
        time.className = 'news-time';
        time.textContent = content.timestamp.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        
        const headline = document.createElement('div');
        headline.className = 'news-headline';
        headline.textContent = content.title;
        
        const source = document.createElement('div');
        source.className = 'news-source';
        source.textContent = new URL(content.url).hostname;
        
        item.appendChild(time);
        item.appendChild(headline);
        item.appendChild(source);
        
        item.addEventListener('click', () => window.open(content.url, '_blank'));
        
        return item;
    }

    async showNewsItem(content) {
        const item = this.createNewsItem(content);
        this.container.innerHTML = ''; // Clear previous item
        this.container.appendChild(item);
        
        // Slide in from right
        item.style.transform = 'translateX(100%)';
        await new Promise(r => setTimeout(r, 50)); // Small delay for animation
        item.style.transform = 'translateX(0)';

        // Get the progress bar element
        const progressBar = this.container.querySelector('::after');
        
        // Animate the progress bar
        const startTime = performance.now();
        const animate = () => {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(elapsed / this.displayDuration, 1);
            this.container.style.setProperty('--progress', progress);
        };

        // Start progress bar animation
        this.container.style.setProperty('--progress', '0');
        const animation = this.container.animate(
            [
                { transform: 'scaleX(0)' },
                { transform: 'scaleX(1)' }
            ],
            {
                duration: this.displayDuration,
                easing: 'linear',
                pseudoElement: '::after'
            }
        );
        
        // Wait for display duration
        await new Promise(r => setTimeout(r, this.displayDuration));
        
        // Slide out to left
        item.style.transform = 'translateX(-100%)';
        await new Promise(r => setTimeout(r, 1000)); // Wait for slide out animation
    }

    async processQueue() {
        while (true) {
            if (this.queue.length > 0 && !this.isAnimating) {
                this.isAnimating = true;
                const content = this.queue.shift();
                await this.showNewsItem(content);
                this.isAnimating = false;
            }
            await new Promise(r => setTimeout(r, 100));
        }
    }

    // Add this method to track the current top links
    getTopLinks() {
        return [...this.sharedLinks.entries()]
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 10)
            .map(([url, data]) => ({
                url,
                title: data.title,
                description: data.description,
                thumb: data.thumbLink ? this.getThumbUrl(data.thumbLink, data.did) : null,
                count: data.count,
                hostname: new URL(url).hostname
            }));
    }

    // Modified updateTopSharedLinks method
    updateTopSharedLinks() {
        const newTopLinks = this.getTopLinks();
        
        // Check if the current top links are different from the last update
        const hasChanged = !this.lastTopLinks || JSON.stringify(newTopLinks) !== JSON.stringify(this.lastTopLinks);
        
        if (hasChanged) {
            // Create a map of existing elements by URL for reuse
            const existingElements = new Map();
            Array.from(this.topSharedContainer.children).forEach(element => {
                const url = element.getAttribute('data-url');
                if (url) existingElements.set(url, element);
            });
            
            // Clear the container
            this.topSharedContainer.innerHTML = '';
            
            newTopLinks.forEach(({url, title, description, thumb, count, hostname}) => {
                let linkElement;
                
                // Reuse existing element if available
                if (existingElements.has(url)) {
                    linkElement = existingElements.get(url);
                    // Update only the dynamic content (count)
                    const statsElement = linkElement.querySelector('.shared-link-stats');
                    if (statsElement) {
                        statsElement.textContent = `Shared ${count} time${count !== 1 ? 's' : ''} • ${hostname}`;
                    }
                } else {
                    // Create new element if it doesn't exist
                    linkElement = document.createElement('div');
                    linkElement.className = 'shared-link';
                    linkElement.setAttribute('data-url', url);
                    
                    // Create the HTML structure
                    const thumbHtml = thumb ? `
                        <div class="shared-link-thumb${!thumb ? ' no-image' : ''}">
                            <img src="${thumb}" alt="" loading="lazy">
                        </div>
                    ` : `
                        <div class="shared-link-thumb no-image"></div>
                    `;
                    
                    linkElement.innerHTML = `
                        ${thumbHtml}
                        <div class="shared-link-content">
                            <div class="shared-link-title">${title}</div>
                            ${description ? `<div class="shared-link-description">${description}</div>` : ''}
                            <div class="shared-link-stats">
                                Shared ${count} time${count !== 1 ? 's' : ''} • 
                                ${hostname}
                            </div>
                        </div>
                    `;
                    
                    // Add image load handler
                    if (thumb) {
                        const img = linkElement.querySelector('img');
                        img.addEventListener('load', () => {
                            img.classList.add('loaded');
                        });
                        img.addEventListener('error', () => {
                            img.parentElement.classList.add('no-image');
                            img.remove();
                        });
                    }
                    
                    linkElement.addEventListener('click', () => window.open(url, '_blank'));
                }
                
                this.topSharedContainer.appendChild(linkElement);
            });
            
            this.lastTopLinks = newTopLinks;
        }
    }

    // Add this helper method to generate thumbnail URLs
    getThumbUrl(thumbLink, did) {
        if (!thumbLink || !did) return null;
        return `https://cdn.bsky.app/img/feed_thumbnail/plain/${did}/${thumbLink}@jpeg`;
    }

    createMarqueeItem(content) {
        const item = document.createElement('div');
        item.className = 'marquee-item';
        
        const thumb = document.createElement('div');
        thumb.className = 'marquee-thumb';
        
        const img = document.createElement('img');
        img.src = content.thumb;
        img.alt = content.title;
        
        const title = document.createElement('div');
        title.className = 'marquee-title';
        title.textContent = content.title;
        
        thumb.appendChild(img);
        item.appendChild(thumb);
        item.appendChild(title);
        
        item.addEventListener('click', () => window.open(content.url, '_blank'));
        
        return item;
    }

    animateMarquee() {
        let position = 0;
        
        const animate = () => {
            position -= this.marqueeSpeed;
            
            // Reset position when first item goes completely off-screen
            if (this.marqueeTrack.children.length > 0) {
                const firstItem = this.marqueeTrack.children[0];
                if (-position > firstItem.offsetWidth + 20) { // 20 is the gap
                    position += firstItem.offsetWidth + 20;
                    // Remove the first item instead of moving it
                    this.marqueeTrack.removeChild(firstItem);
                }
            }
            
            this.marqueeTrack.style.transform = `translateX(${position}px)`;
            requestAnimationFrame(animate);
        };
        
        requestAnimationFrame(animate);
    }

    updateTimeIndicator() {
        const minutesSinceStart = Math.floor((new Date() - this.startTime) / 60000);
        let timeText;
        
        if (minutesSinceStart < 1) {
            timeText = '(gathering first stories... please wait)<span class="loading-spinner"></span>';
        } else {
            // Remove spinner when switching to time display
            timeText = `(last ${minutesSinceStart} minute${minutesSinceStart > 1 ? 's' : ''})`;
        }
        
        if (this.timeIndicator) {
            this.timeIndicator.innerHTML = timeText;
        }
    }
}

// Initialize when page loads
window.addEventListener('load', () => {
    new NewsStream();
});