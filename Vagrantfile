# -*- mode: ruby -*-
# vi: set ft=ruby :

VAGRANTFILE_API_VERSION = "2"

Vagrant.configure(VAGRANTFILE_API_VERSION) do |config|
  config.vm.box = "trusty"
  config.vm.box_url = "https://cloud-images.ubuntu.com/vagrant/trusty/current/trusty-server-cloudimg-i386-vagrant-disk1.box"
  # http://files.vagrantup.com/precise64.box
  config.vm.network :forwarded_port, host: 8015, guest: 8005
  config.vm.provider :virtualbox do |vb|
      vb.customize ["modifyvm", :id, "--memory", "2024", "--cpus", 2]
  end

  config.vm.provision :shell, :path => "setup/bootstrap.sh"

end
