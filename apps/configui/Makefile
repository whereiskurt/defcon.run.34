.PHONY: build run clean

build:
	go build -o configui .

run: build
	./configui

clean:
	rm -f configui
	rm -rf backups/
