import Phaser from 'phaser';
import { W, H }        from './config.js';
import { GameScene }   from './scenes/GameScene.js';

new Phaser.Game({
  type:            Phaser.AUTO,
  width:           W,
  height:          H,
  backgroundColor: '#080e18',
  scene:           [GameScene],
  parent:          document.body,
  scale: {
    mode:       Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
});
